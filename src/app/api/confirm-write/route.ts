/**
 * POST /api/confirm-write
 *
 * Resolves a pending write statement (spec §6). The user can:
 *   - "confirm": execute and commit the statement.
 *   - "rollback": dry-run inside a transaction we roll back (shows affected
 *      row count without committing — spec §6.4).
 *   - "cancel": discard the pending write without running it.
 *
 * Every resolution is recorded in the audit log regardless of outcome
 * (spec §6.5).
 */
import { NextRequest, NextResponse } from "next/server";
import type { ConfirmWriteRequest } from "@/lib/types";
import { confirmAndExecute } from "@/lib/pending-writes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: ConfirmWriteRequest;
  try {
    body = (await req.json()) as ConfirmWriteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.pendingId || !body.action) {
    return NextResponse.json({ error: "pendingId and action are required." }, { status: 400 });
  }

  const result = await confirmAndExecute(body.pendingId, body.action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    status: result.status,
    rowsAffected: result.rowsAffected,
  });
}
