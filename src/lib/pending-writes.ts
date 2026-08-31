/**
 * In-memory registry of pending write statements awaiting user confirmation.
 *
 * When the SQL agent produces a write in Zen mode it does NOT execute it
 * (spec §6.3). Instead the orchestrator registers the pending write here,
 * keyed by a pendingId, and the frontend sends that id back to
 * /api/confirm-write. Pending writes expire after 10 minutes.
 */
import { getConnection } from "@/lib/db-connection";
import { auditWrite } from "@/lib/session";
import { randomUUID } from "crypto";

interface PendingWrite {
  pendingId: string;
  sessionId: string;
  query: string;
  estimatedImpact: string;
  createdAt: number;
}

const registry = new Map<string, PendingWrite>();
const TTL_MS = 10 * 60 * 1000;

export function registerPendingWrite(
  sessionId: string,
  query: string,
  estimatedImpact: string
): string {
  // Expire old entries opportunistically.
  const now = Date.now();
  for (const [id, pw] of registry) {
    if (now - pw.createdAt > TTL_MS) registry.delete(id);
  }
  const pendingId = randomUUID();
  registry.set(pendingId, { pendingId, sessionId, query, estimatedImpact, createdAt: now });
  return pendingId;
}

export function getPendingWrite(pendingId: string): PendingWrite | undefined {
  const pw = registry.get(pendingId);
  if (!pw) return undefined;
  if (Date.now() - pw.createdAt > TTL_MS) {
    registry.delete(pendingId);
    return undefined;
  }
  return pw;
}

export async function confirmAndExecute(pendingId: string, action: "confirm" | "rollback" | "cancel") {
  const pw = getPendingWrite(pendingId);
  if (!pw) return { ok: false, error: "This pending write has expired or was already resolved." };

  if (action === "cancel") {
    registry.delete(pendingId);
    await auditWrite(pw.sessionId, pw.query, "rolled_back", 0, "Cancelled by user before execution.");
    return { ok: true, status: "cancelled" as const, rowsAffected: 0 };
  }

  const conn = getConnection(pw.sessionId);
  if (!conn) {
    registry.delete(pendingId);
    return { ok: false, error: "No active database connection for this session." };
  }

  try {
    if (action === "rollback") {
      // Dry-run inside a transaction we roll back (spec §6.4).
      const res = await conn.executeWrite(pw.query, { rollback: true });
      await auditWrite(pw.sessionId, pw.query, "rolled_back", res.rowsAffected, "Dry-run: rolled back after showing affected rows.");
      registry.delete(pendingId);
      return { ok: true, status: "rolled_back" as const, rowsAffected: res.rowsAffected };
    }
    // action === "confirm"
    const res = await conn.executeWrite(pw.query, { rollback: false });
    await auditWrite(pw.sessionId, pw.query, "executed", res.rowsAffected, "Confirmed by user.");
    registry.delete(pendingId);
    return { ok: true, status: "executed" as const, rowsAffected: res.rowsAffected };
  } catch (e) {
    await auditWrite(pw.sessionId, pw.query, "failed", 0, (e as Error).message);
    registry.delete(pendingId);
    return { ok: false, error: (e as Error).message };
  }
}
