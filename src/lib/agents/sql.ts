/**
 * SQL agent (spec §5 + §6 safety-critical Zen-mode gating).
 *
 * Takes the user's question + relevant schema subset + recent context and
 * generates a single SQL query. Hard rules:
 *  - Only ever emit SELECT unless zen_mode is true.
 *  - Always apply a row limit (default 500) unless the user explicitly asks
 *    for an aggregate / count-only query.
 *  - Return the SQL as a distinct, inspectable field (never buried in prose).
 *  - In zen mode, if the statement is a write, do NOT execute it — populate
 *    pendingWrite and route to the confirmation step.
 *  - After execution, hand the resulting dataframe to downstream agents
 *    (EDA/viz/ML) rather than interpreting the data itself.
 */
import { completeJson, complete } from "@/lib/llm";
import type { AgentState, CanvasObject, SqlCanvasObject, PendingWriteCanvasObject, TableCanvasObject } from "@/lib/types";
import { renderRelevantSchema } from "./schema-utils";
import { getConnection, isWriteStatement, applyRowLimit } from "@/lib/db-connection";
import { storeFrame } from "@/lib/frame-cache";
import { registerPendingWrite } from "@/lib/pending-writes";

export interface SqlAgentOutput {
  sql: string;
  isWrite: boolean;
  /** Present when executed as a read. */
  result?: { columns: { name: string; dtype?: string }[]; rows: Record<string, unknown>[]; rowCount: number; durationMs: number; frameId?: string };
  /** Present when a write is gated behind confirmation. */
  pending?: { pendingId: string; estimatedImpact: string };
  /** Present when execution failed. */
  error?: string;
  canvas: CanvasObject[];
}

const SYSTEM = `You are the SQL agent for a database-analysis assistant. You write a SINGLE SQL query that answers the user's question, given the database schema.

Hard rules:
1. Output ONLY a JSON object: { "sql": "SELECT ...", "intent": "select|aggregate|write", "rationale": "short note" }. No prose, no markdown fences.
2. The "sql" field must contain exactly one SQL statement ending with a semicolon.
3. NEVER write INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE unless the user has explicitly requested a data change AND zen mode is on. If zen mode is off and the user asks for a write, set "intent":"write" but write a harmless SELECT that explains the situation instead — the orchestrator will tell the user to enable Zen mode.
4. Always favour SELECT. Apply a LIMIT 500 unless the query is clearly an aggregate (uses GROUP BY, COUNT, SUM, AVG, MAX, MIN without returning raw rows) or the user asked for "all".
5. Use only standard SQL compatible with the dialect given. Quote identifiers only when necessary.
6. Reference real table and column names from the provided schema only. Never invent names.
7. For "top N" questions use ORDER BY ... LIMIT N. For "breakdown" use GROUP BY.
8. Keep queries readable; don't add unnecessary subqueries.`;

export async function runSqlAgent(state: AgentState): Promise<SqlAgentOutput> {
  const snap = state.schemaSnapshot;
  if (!snap) {
    return { sql: "", isWrite: false, error: "No schema is available. Connect to a database first.", canvas: [] };
  }

  const schemaText = renderRelevantSchema(snap, state.userInput, 10);
  const history = state.messages.slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n");

  let sql = "";
  let intent: "select" | "aggregate" | "write" = "select";
  const userPrompt = `Dialect: ${snap.dialect}
Zen mode (writes allowed): ${state.zenMode ? "YES" : "NO"}

Schema (most relevant tables):
${schemaText}

Recent conversation:
${history || "(none)"}

User question:
"""${state.userInput}"""

Write the SQL. Return ONLY JSON.`;
  try {
    const out = await completeJson<{ sql: string; intent: string; rationale?: string }>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1 }
    );
    sql = (out.sql || "").trim();
    intent = (out.intent === "write" ? "write" : out.intent === "aggregate" ? "aggregate" : "select");
  } catch (e) {
    // Fallback: the model often returns near-valid JSON with one malformed
    // field. Try to salvage the SQL via regex before giving up.
    const raw = await complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1 }
    );
    sql = extractSqlRegex(raw);
    if (!sql) {
      return { sql: "", isWrite: false, error: `Failed to generate SQL: ${(e as Error).message}`, canvas: [] };
    }
    intent = isWriteStatement(sql) ? "write" : /\b(group by|count|sum|avg|min|max)\b/i.test(sql) ? "aggregate" : "select";
  }

  if (!sql) {
    return { sql: "", isWrite: false, error: "The model returned an empty SQL statement.", canvas: [] };
  }

  const isWrite = isWriteStatement(sql);

  // ---- Zen-mode gating (spec §6.3) -------------------------------------
  if (isWrite) {
    if (!state.zenMode) {
      // Refuse to execute; surface a helpful message instead.
      const blockedSql: SqlCanvasObject = {
        type: "sql",
        query: sql,
        executed: false,
        error: "Blocked: this is a write statement but Zen mode is off. Enable Zen mode to run it.",
      };
      return {
        sql,
        isWrite: true,
        error: blockedSql.error,
        canvas: [blockedSql],
      };
    }
    // Zen mode is on → don't execute; gate behind confirmation.
    const estimatedImpact = await estimateWriteImpact(sql, state);
    const pendingId = registerPendingWrite(state.sessionId, sql, estimatedImpact);
    const pending: PendingWriteCanvasObject = {
      type: "pending_write",
      query: sql,
      estimatedImpact,
      pendingId,
      status: "pending",
    };
    return {
      sql,
      isWrite: true,
      pending: { pendingId, estimatedImpact },
      canvas: [pending],
    };
  }

  // ---- Execute the read -------------------------------------------------
  const conn = getConnection(state.sessionId);
  if (!conn) {
    return { sql, isWrite: false, error: "No active database connection for this session.", canvas: [] };
  }

  // Apply a row limit if the model didn't (defensive — applies only to SELECTs).
  const guarded = intent === "aggregate" ? sql.replace(/;$/, "") : applyRowLimit(sql, 500);
  try {
    const result = await conn.query(guarded, 500);
    const frame = storeFrame(result, guarded);
    const tableObj: TableCanvasObject = {
      type: "table",
      title: "Query result",
      columns: result.columns,
      rows: result.rows.slice(0, 200),
      totalRows: result.rowCount,
      truncated: result.rowCount > 200,
    };
    const sqlObj: SqlCanvasObject = {
      type: "sql",
      query: guarded,
      executed: true,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
    };
    return {
      sql: guarded,
      isWrite: false,
      result: { columns: result.columns, rows: result.rows, rowCount: result.rowCount, durationMs: result.durationMs, frameId: frame.id },
      canvas: [sqlObj, tableObj],
    };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const sqlObj: SqlCanvasObject = { type: "sql", query: guarded, executed: false, error: msg };
    return { sql: guarded, isWrite: false, error: msg, canvas: [sqlObj] };
  }
}

/**
 * Best-effort impact estimate for a pending write. Tries a dry-run EXPLAIN
 * or a row-count preview; falls back to a generic statement.
 */
async function estimateWriteImpact(sql: string, state: AgentState): Promise<string> {
  const conn = getConnection(state.sessionId);
  if (!conn) return "Unable to estimate — no active connection.";

  const trimmed = sql.trim();
  const m = trimmed.match(/^(\s)*(UPDATE|DELETE)\b(.*)/i);
  try {
    if (m) {
      // Convert UPDATE/DELETE to a counting SELECT on the same WHERE.
      const rest = m[3];
      const whereMatch = rest.match(/\bwhere\b(.*)/i);
      const where = whereMatch ? `WHERE ${whereMatch[1].replace(/;$/, "")}` : "";
      const tableMatch = rest.match(/^\s+(\w+)/);
      const table = tableMatch ? tableMatch[1] : "target_table";
      const countSql = `SELECT COUNT(*) AS affected FROM ${table} ${where}`;
      const r = await conn.query(countSql, 1);
      const n = Number(r.rows[0]?.affected ?? 0);
      return `Approximately ${n.toLocaleString()} row${n === 1 ? "" : "s"} will be affected.`;
    }
    if (/^insert\b/i.test(trimmed)) return "One or more rows will be inserted.";
    if (/^(alter|drop|create|truncate)\b/i.test(trimmed)) return "This statement changes database structure. The effect is not reversible.";
  } catch {
    /* fall through */
  }
  return "Impact could not be precisely estimated. Review the SQL carefully before confirming.";
}

/**
 * Salvage a SQL statement from a model response whose surrounding JSON is
 * malformed. Tries (1) a quoted "sql" field, then (2) any line that looks
 * like a SELECT/INSERT/UPDATE/DELETE/DDL statement up to a semicolon.
 */
function extractSqlRegex(raw: string): string {
  // Strip markdown fences first.
  const fenced = raw.match(/```(?:sql|json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;

  // 1. Quoted "sql": "..."  (handles escaped quotes)
  const m1 = body.match(/"sql"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (m1) {
    return m1[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  }
  // 2. A bare SQL statement ending with a semicolon.
  const m2 = body.match(/\b(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE)\b[\s\S]*?;/i);
  if (m2) return m2[0].trim();
  return "";
}
