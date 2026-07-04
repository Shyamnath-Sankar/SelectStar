/**
 * Synthesis / responder node (spec §5).
 *
 * The only node that talks "to the user" in prose. Takes whatever the
 * specialist agents produced (structured data + short internal summaries)
 * and writes the final chat reply. Also finalises the canvas object list.
 * Streams the reply token-by-token via the provided callback.
 */
import { completeStream } from "@/lib/llm";
import type { AgentState, CanvasObject } from "@/lib/types";

const SYSTEM = `You are the synthesis node of an agentic database-analysis assistant.
Specialist agents (SQL, EDA, Viz, ML, Schema) have already done their work and
produced structured results. Your job is to write the final, user-facing reply.

Style:
- Be concise and confident. Lead with the direct answer, then add at most 2-3
  sentences of useful context.
- Use markdown: **bold** key numbers, short bullet lists where helpful, and
  \`inline code\` for table/column names.
- Never invent data. Use only what the agents reported. If something failed,
  say so plainly and suggest a next step.
- Do NOT restate the SQL in full — the canvas already shows it. You may mention
  "the query returned N rows" or "I grouped by status".
- Reference charts/tables that appear in the canvas as "the chart on the right"
  or "the table above".
- If a write was gated behind Zen-mode confirmation, tell the user to review
  and confirm it in the canvas.`;

export async function runSynthesis(
  state: AgentState,
  agentSummaries: { agent: string; summary: string }[],
  canvas: CanvasObject[],
  onToken: (delta: string) => void
): Promise<string> {
  const recent = state.messages
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 250)}`)
    .join("\n");

  const agentSection = agentSummaries.length
    ? agentSummaries.map((a) => `### ${a.agent}\n${a.summary}`).join("\n\n")
    : "(no specialist agents ran this turn)";

  const canvasSection = canvas.length
    ? canvas.map((c, i) => `[${i + 1}] ${describeCanvas(c)}`).join("\n")
    : "(no canvas artifacts)";

  const userPrompt = `User's question:
"""${state.userInput}"""

Recent conversation:
${recent || "(none)"}

What the specialist agents produced:
${agentSection}

Canvas artifacts that will be shown to the user:
${canvasSection}

Write the final reply for the user now.`;

  const reply = await completeStream(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    onToken,
    { temperature: 0.4 }
  );
  return reply.trim();
}

function describeCanvas(c: CanvasObject): string {
  switch (c.type) {
    case "table":
      return `TABLE "${c.title || "Query result"}" — ${c.totalRows ?? c.rows.length} rows, columns: ${c.columns.map((x) => x.name).join(", ")}`;
    case "chart":
      return `CHART "${c.title || "untitled"}" — ${typeof c.spec.mark === "object" && c.spec.mark ? (c.spec.mark as { type?: string }).type : c.spec.mark}`;
    case "sql":
      return `SQL — executed: ${c.executed}${c.rowCount !== undefined ? `, ${c.rowCount} rows` : ""}${c.error ? `, error: ${c.error}` : ""}`;
    case "eda_summary":
      return `EDA SUMMARY — ${c.columns.length} columns profiled${c.insights?.length ? `, ${c.insights.length} correlations` : ""}`;
    case "model_result":
      return `MODEL RESULT (${c.modelType}) — metrics: ${JSON.stringify(c.metrics)}`;
    case "pending_write":
      return `PENDING WRITE — awaiting confirmation (${c.estimatedImpact})`;
    case "error":
      return `ERROR — ${c.message}`;
  }
}
