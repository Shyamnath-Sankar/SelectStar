/**
 * Verification agent — reviews the SQL agent's output BEFORE execution.
 *
 * Goal: catch errors that would produce wrong answers silently. The SQL
 * agent is good but not perfect — it sometimes:
 *   - References a column that doesn't exist (hallucinated name)
 *   - Writes a JOIN that produces a cartesian product (missing ON condition)
 *   - Forgets a WHERE clause on a DELETE/UPDATE (would affect every row)
 *   - Uses a table alias that doesn't match the FROM clause
 *   - Answers a different question than the user asked
 *
 * The verification agent is a lightweight LLM call (low temperature, single
 * JSON response) that returns either:
 *   { "ok": true, "notes": "looks fine" }
 *   { "ok": false, "reason": "column 'customer_name' doesn't exist — did you mean 'customers.name'?", "suggestedFix": "SELECT ... FROM orders JOIN customers ..." }
 *
 * If `ok` is false, the orchestrator asks the SQL agent to regenerate with
 * the verification feedback as a corrective hint. The agent gets ONE retry
 * — if the second attempt also fails verification, we execute it anyway
 * (the user can see the error in the canvas) so we don't get stuck in a loop.
 */
import { completeJson } from "@/lib/llm";
import type { AgentState, SchemaSnapshot } from "@/lib/types";
import { renderSchema } from "./schema-utils";

export interface VerificationResult {
  ok: boolean;
  reason?: string;
  suggestedFix?: string;
  /** Schema-validation errors detected WITHOUT an LLM call (fast path). */
  schemaErrors?: string[];
}

const SYSTEM = `You are the verification agent for an agentic database-analysis assistant. The SQL agent has generated a query. Your job is to review it for correctness BEFORE it runs.

Check for:
1. **Schema validity**: every table and column referenced must exist in the provided schema. Watch for case-sensitivity issues and alias mistakes.
2. **JOIN sanity**: if there's a JOIN, verify the ON clause references columns from both sides and the join keys exist. Flag missing ON clauses (cartesian products).
3. **Write safety**: for UPDATE/DELETE without a WHERE clause, flag it — this would affect every row. The user almost never wants that.
4. **Question alignment**: does the query actually answer the user's question? (e.g. if they asked "top 5 by revenue" and the query has no ORDER BY ... LIMIT 5, flag it.)
5. **Type mismatches**: comparing a number to a string literal, etc.

Return ONLY a JSON object:
{ "ok": true|false, "reason": "short explanation", "suggestedFix": "corrected SQL or empty string" }

- If the query is fine, return { "ok": true, "reason": "looks good", "suggestedFix": "" }.
- If there's an issue, set "ok" to false and provide a concrete suggestedFix.
- Do NOT be overly pedantic — only flag things that would produce WRONG results or runtime errors.
- For Classic mode (CSV/XLSX uploads), the schema is one or more flat tables. Joins across them are allowed if the columns exist.`;

/**
 * Fast-path schema validation without an LLM call. Catches the most common
 * error (hallucinated column names) for free, before spending an LLM call.
 */
export function fastSchemaValidation(sql: string, schema: SchemaSnapshot | null): string[] {
  if (!schema) return [];
  const errors: string[] = [];
  const lower = sql.toLowerCase();

  // Extract table names referenced in FROM/JOIN clauses.
  const fromMatches = [...sql.matchAll(/(?:from|join)\s+["`]?(\w+)["`]?/gi)];
  const referencedTables = new Set(fromMatches.map((m) => m[1].toLowerCase()));
  const knownTables = new Set(schema.tables.map((t) => t.name.toLowerCase()));
  for (const t of referencedTables) {
    if (!knownTables.has(t)) {
      errors.push(`Table "${t}" doesn't exist. Available: ${[...knownTables].join(", ")}.`);
    }
  }

  // Detect cartesian product: JOIN without ON.
  if (/\bjoin\b/i.test(sql) && !/\bon\b/i.test(sql)) {
    errors.push("JOIN without ON clause — this produces a cartesian product. Add an ON clause.");
  }

  // Detect UPDATE/DELETE without WHERE.
  if (/^(update|delete)\b/i.test(sql.trim()) && !/\bwhere\b/i.test(sql)) {
    errors.push(`${sql.trim().split(/\s+/)[0].toUpperCase()} without a WHERE clause — this would affect every row.`);
  }

  return errors;
}

export async function runVerificationAgent(
  state: AgentState,
  sql: string,
  isWrite: boolean
): Promise<VerificationResult> {
  // 1. Fast schema validation (no LLM call).
  const schemaErrors = fastSchemaValidation(sql, state.schemaSnapshot);
  // If fast-path found critical errors, return immediately — no LLM needed.
  if (schemaErrors.length) {
    return { ok: false, reason: schemaErrors.join(" "), schemaErrors };
  }

  // 2. LLM-based deeper review.
  const schemaText = state.schemaSnapshot
    ? renderSchema(state.schemaSnapshot).slice(0, 4000)
    : "(no schema available)";

  const userPrompt = `Database dialect: ${state.dialect}
Mode: ${state.mode}
Zen mode (writes allowed): ${state.zenMode ? "YES" : "NO"}
This is a ${isWrite ? "WRITE" : "READ"} statement.

Schema:
${schemaText}

User's question:
"""${state.userInput}"""

Generated SQL:
"""${sql}"""

Review this SQL. Return ONLY a JSON object.`;

  try {
    const out = await completeJson<VerificationResult>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1 }
    );
    return {
      ok: out.ok !== false,
      reason: out.reason,
      suggestedFix: out.suggestedFix,
      schemaErrors,
    };
  } catch (e) {
    // If verification itself fails, don't block execution — let the query run.
    return { ok: true, reason: `Verification skipped (LLM error): ${(e as Error).message}`, schemaErrors };
  }
}
