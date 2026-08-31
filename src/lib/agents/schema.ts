/**
 * Schema agent (spec §5).
 *
 * Answers structural questions ("what tables", "describe orders") directly
 * from the cached SchemaSnapshot — no LLM call needed for pure lookups.
 * Only calls the LLM to phrase the answer conversationally.
 */
import { complete } from "@/lib/llm";
import type { AgentState, CanvasObject } from "@/lib/types";
import { renderTable, relevantTables } from "./schema-utils";

export interface SchemaAgentOutput {
  reply: string;
  canvas: CanvasObject[];
}

const SYSTEM = `You are the schema agent for a database-analysis assistant.
You answer questions about the structure of the connected database — tables,
columns, types, keys, foreign keys, row counts. You do NOT run SQL.

Guidance:
- Be concise but complete. Use short markdown tables or bullet lists.
- When describing a table, mention its columns with types and whether each is
  a primary key or foreign key, plus the approximate row count.
- Never invent columns or tables. Use only the schema provided.`;

export async function runSchemaAgent(state: AgentState): Promise<SchemaAgentOutput> {
  const snap = state.schemaSnapshot;
  if (!snap) {
    return { reply: "I don't have a schema snapshot yet. Try connecting to a database first.", canvas: [] };
  }

  const q = state.userInput.toLowerCase();

  // Pure lookup: "what tables" / "list tables" → no LLM needed.
  if (/\b(what|which|list|show)\b.*\btable/i.test(q) || q.includes("how many table")) {
    const lines = snap.tables.map(
      (t) => `- **${t.name}** — ~${t.rowCount.toLocaleString()} rows, ${t.columns.length} columns${t.description ? ` (${t.description})` : ""}`
    );
    const reply = `This database has **${snap.tables.length}** table${snap.tables.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`;
    return { reply, canvas: [] };
  }

  // "describe <table>" / "what does X look like" → find the table.
  const target = findTableMention(q, snap.tables.map((t) => t.name));
  if (target && (/\b(describe|what.*look|structure|columns? of|schema of|detail)\b/i.test(q))) {
    const t = snap.tables.find((x) => x.name.toLowerCase() === target.toLowerCase());
    if (t) {
      const reply = `**${t.name}**${t.description ? ` — ${t.description}` : ""} (~${t.rowCount.toLocaleString()} rows):\n\n${formatTableMarkdown(t)}`;
      return { reply, canvas: [] };
    }
  }

  // Otherwise, hand the relevant schema subset to the LLM to phrase an answer.
  const subset = relevantTables(snap, state.userInput, 12);
  const schemaText = subset.map(renderTable).join("\n\n");
  const reply = await complete(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Database dialect: ${snap.dialect}\n\nRelevant schema:\n${schemaText}\n\nQuestion: ${state.userInput}\n\nAnswer concisely.`,
      },
    ],
    { temperature: 0.2 }
  );
  return { reply, canvas: [] };
}

function findTableMention(q: string, tableNames: string[]): string | null {
  for (const name of tableNames) {
    if (q.includes(name.toLowerCase())) return name;
  }
  return null;
}

function formatTableMarkdown(t: { name: string; rowCount: number; columns: { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; isForeignKey: boolean; references?: { table: string; column: string } | null }[] }): string {
  const header = `| column | type | nullable | key |\n| --- | --- | --- | --- |`;
  const rows = t.columns.map((c) => {
    const key = c.isPrimaryKey ? "PK" : c.isForeignKey && c.references ? `FK→${c.references.table}` : "";
    return `| ${c.name} | ${c.dataType} | ${c.nullable ? "yes" : "no"} | ${key} |`;
  });
  return header + "\n" + rows.join("\n");
}

/** Re-exported for the orchestrator's suggested-questions path. */
export { renderSchema } from "./schema-utils";
