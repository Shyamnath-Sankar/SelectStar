/**
 * Server-side helpers for loading/saving session state to the app database
 * (Prisma). Keeps API routes thin.
 */
import { db } from "@/lib/db";
import { openConnection, closeConnection } from "@/lib/db-connection";
import type { AgentState, AgentMessage, CanvasObject, SchemaSnapshot } from "@/lib/types";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";

export interface SessionState {
  sessionId: string;
  dialect: AgentState["dialect"];
  zenMode: boolean;
  canWrite: boolean;
  schemaSnapshot: SchemaSnapshot | null;
  messages: AgentMessage[];
  label: string;
  suggestedQuestions: string[];
}

export async function loadSessionState(sessionId: string): Promise<SessionState | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      canvasObjects: { orderBy: [{ turn: "asc" }, { order: "asc" }] },
    },
  });
  if (!session) return null;

  let schemaSnapshot: SchemaSnapshot | null = null;
  if (session.schemaSnapshot) {
    try { schemaSnapshot = JSON.parse(session.schemaSnapshot) as SchemaSnapshot; } catch { /* ignore */ }
  }

  // Reopen the live DB connection if it isn't already cached.
  try {
    await openConnection(sessionId, session.connectionString);
  } catch {
    // If the connection can't be reopened (e.g. unreachable host), we still
    // let the user browse past results; agents that need a live query will fail.
  }

  const messages: AgentMessage[] = session.messages.map((m) => ({
    role: m.role as AgentMessage["role"],
    content: m.content,
  }));

  const suggestedQuestions = schemaSnapshot ? suggestStarterQuestions(schemaSnapshot) : [];

  return {
    sessionId,
    dialect: session.dialect as AgentState["dialect"],
    zenMode: session.zenMode,
    canWrite: session.canWrite,
    schemaSnapshot,
    messages,
    label: session.label,
    suggestedQuestions,
  };
}

export async function saveMessage(sessionId: string, role: AgentMessage["role"], content: string, meta?: Record<string, unknown>) {
  await db.message.create({
    data: { sessionId, role, content, meta: meta ? JSON.stringify(meta) : null },
  });
}

export async function saveCanvasObject(sessionId: string, turn: number, order: number, obj: CanvasObject) {
  await db.canvasObject.create({
    data: {
      sessionId,
      turn,
      order,
      type: obj.type,
      data: JSON.stringify(obj),
    },
  });
}

export async function loadCanvasHistory(sessionId: string): Promise<CanvasObject[]> {
  const rows = await db.canvasObject.findMany({
    where: { sessionId },
    orderBy: [{ turn: "asc" }, { order: "asc" }],
  });
  return rows.map((r) => JSON.parse(r.data) as CanvasObject);
}

export async function auditWrite(sessionId: string, sql: string, status: string, rowsAffected: number, note?: string) {
  await db.auditLog.create({ data: { sessionId, sql, status, rowsAffected, note } });
}

export async function listAuditLogs(sessionId: string) {
  return db.auditLog.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" } });
}

export async function closeSession(sessionId: string) {
  closeConnection(sessionId);
}

/** Build the AgentState the orchestrator expects, from a loaded session. */
export function toAgentState(s: SessionState, userInput: string): AgentState {
  return {
    sessionId: s.sessionId,
    dialect: s.dialect,
    schemaSnapshot: s.schemaSnapshot,
    zenMode: s.zenMode,
    messages: s.messages,
    userInput,
    routedAgents: [],
    canvasObjects: [],
    steps: [],
    pendingWrite: null,
  };
}
