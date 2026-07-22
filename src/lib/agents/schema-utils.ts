/**
 * Helpers for working with a SchemaSnapshot inside agent prompts.
 *
 * Spec §4.6: for large schemas don't inject the entire schema into every
 * prompt. We use a simple keyword-matching heuristic (good enough for v1 —
 * upgradeable to embeddings later) to pick the top-N relevant tables for a
 * given question.
 */
import type { SchemaSnapshot, TableInfo } from "@/lib/types";

/** A compact, LLM-friendly textual rendering of a table. */
export function renderTable(t: TableInfo): string {
  const cols = t.columns
    .map((c) => {
      const tags: string[] = [];
      if (c.isPrimaryKey) tags.push("PK");
      if (c.isForeignKey && c.references) tags.push(`FK→${c.references.table}(${c.references.column})`);
      const nullable = c.nullable ? "" : " NOT NULL";
      const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
      return `  - ${c.name} ${c.dataType}${nullable}${tagStr}`;
    })
    .join("\n");
  const desc = t.description ? ` (${t.description})` : "";
  return `TABLE ${t.name}${desc} [~${t.rowCount} rows]\n${cols}`;
}

/** Render the full schema as text (used when the schema is small). */
export function renderSchema(snapshot: SchemaSnapshot): string {
  return snapshot.tables.map(renderTable).join("\n\n");
}

/**
 * Keyword-based relevance filtering. Picks the top-N tables whose name or
 * column names overlap most with the question's tokens. Always includes a
 * few "anchor" tables (highest row count) so the model has context.
 */
export function relevantTables(snapshot: SchemaSnapshot, question: string, topN = 8): TableInfo[] {
  const qTokens = tokenize(question);
  if (!qTokens.length || snapshot.tables.length <= topN) return snapshot.tables;

  const scored = snapshot.tables.map((t) => {
    let score = 0;
    const nameToks = tokenize(t.name);
    for (const tok of nameToks) if (qTokens.includes(tok)) score += 3;
    for (const c of t.columns) {
      const cToks = tokenize(c.name);
      for (const tok of cToks) if (qTokens.includes(tok)) score += 2;
    }
    // Small bias for bigger tables (they usually matter more).
    score += Math.min(2, Math.log10(Math.max(1, t.rowCount)));
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.t);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "show", "give",
  "tell", "about", "how", "many", "all", "each", "per", "into", "where", "which",
  "have", "has", "are", "was", "were", "get", "find", "list", "want", "need",
  "please", "can", "you", "our", "out", "over", "under", "than", "then",
]);

/** Render only the relevant subset of a schema for a question. */
export function renderRelevantSchema(snapshot: SchemaSnapshot, question: string, topN = 8): string {
  const tables = relevantTables(snapshot, question, topN);
  const header = tables.length < snapshot.tables.length
    ? `(${tables.length} of ${snapshot.tables.length} tables shown — most relevant to your question)\n\n`
    : "";
  return header + tables.map(renderTable).join("\n\n");
}

/**
 * Generate 3-4 suggested starter questions from the actual schema
 * (spec §8 empty/first-run state). Pure heuristic, no LLM call.
 */
export function suggestStarterQuestions(snapshot: SchemaSnapshot): string[] {
  const out: string[] = [];
  const find = (kw: string) => snapshot.tables.find((t) => t.name.toLowerCase().includes(kw));

  // Classic mode (single-table CSV/XLSX dataset) — generic exploratory prompts.
  if (snapshot.tables.length === 1) {
    const t = snapshot.tables[0];
    const numericCols = t.columns.filter((c) => isNumericType(c.dataType));
    const textCols = t.columns.filter((c) => !isNumericType(c.dataType) && c.dataType !== "date");
    const dateCols = t.columns.filter((c) => c.dataType === "date");

    out.push(`How many rows are in this dataset, and what does each column look like?`);
    if (numericCols.length >= 1) {
      out.push(`Give me a statistical summary of ${numericCols.slice(0, 2).map((c) => `\`${c.name}\``).join(" and ")}.`);
    }
    if (textCols.length >= 1 && numericCols.length >= 1) {
      out.push(`What are the top values in \`${textCols[0].name}\` by total \`${numericCols[0].name}\`?`);
    }
    if (numericCols.length >= 1) {
      out.push(`Chart the distribution of \`${numericCols[0].name}\`.`);
    } else if (textCols.length >= 1) {
      out.push(`Chart the distribution of \`${textCols[0].name}\`.`);
    }
    if (dateCols.length >= 1 && numericCols.length >= 1) {
      out.push(`Plot \`${numericCols[0].name}\` over \`${dateCols[0].name}\`.`);
    }
    out.push(`Enable Zen mode above, then ask me to "delete rows where \`${numericCols[0]?.name || textCols[0]?.name || "column"}\` is null".`);
    return out.slice(0, 5);
  }

  const orders = find("order");
  const customers = find("customer");
  const products = find("product");

  if (orders) out.push(`How many orders are there, broken down by status?`);
  if (customers) out.push(`Who are the top 10 customers by order count?`);
  if (orders && customers) out.push(`Show me the distribution of order totals.`);
  if (products) out.push(`Which products have the lowest stock?`);
  if (out.length < 3) out.push(`What tables are in this database?`);
  if (out.length < 4) out.push(`Give me a statistical summary of the largest table.`);

  return out.slice(0, 4);
}

function isNumericType(dt?: string): boolean {
  if (!dt) return false;
  const d = dt.toLowerCase();
  return ["number", "integer", "int", "real", "float", "double", "decimal", "numeric"].some((t) => d.includes(t));
}
