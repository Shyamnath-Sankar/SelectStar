/**
 * Synthesis / responder node (spec §5).
 *
 * The only node that talks "to the user" in prose. Takes whatever the
 * specialist agents produced (structured data + short internal summaries)
 * and writes the final chat reply. Also finalises the canvas object list.
 * Streams the reply token-by-token via the provided callback.
 */
import { completeStream, completeJson } from "@/lib/llm";
import type { AgentState, CanvasObject } from "@/lib/types";

const SYSTEM = `You are the synthesis node of an agentic database-analysis assistant.
Specialist agents (SQL, EDA, Viz, ML, Schema, Report) have already done their work and
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
  and confirm it in the canvas.
- If this is a Classic-mode session (CSV/XLSX upload), and the user asked to
  edit the data, mention they can download the updated file from the top bar
  or edit it directly in the Spreadsheet tab.
- If the Report agent produced a report_plan card, briefly mention what the
  user should do next ("pick a focus, depth, and sections, then click Generate
  Report"). Do not list every option — the canvas card has them.
- If the Report agent produced a full report, briefly summarise the most
  important finding in 1-2 sentences and direct the user to the canvas to
  read the rest. Do NOT reproduce the full report body in chat — the canvas
  is the primary surface for reports.`;

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
    case "report_plan":
      return `REPORT PLAN — ${c.focusOptions.length} focus options, ${c.depthOptions.length} depth options, ${c.sectionOptions.length} section options. User should pick options and click "Generate Report".`;
    case "report":
      return `REPORT "${c.title}" — ${c.sections.length} sections, ${c.hiddenPatterns.length} hidden patterns, ${c.keyMetrics.length} key metrics, dataset ${c.datasetSummary.rows.toLocaleString()} rows × ${c.datasetSummary.columns} columns${c.datasetSummary.timespan ? `, timespan ${c.datasetSummary.timespan}` : ""}`;
    case "data_quality":
      return `DATA QUALITY — ${c.issues.length} issues, health score ${c.healthScore}`;
    case "error":
      return `ERROR — ${c.message}`;
  }
}

// ---------------------------------------------------------------------------
// Follow-up suggestions — emitted as a separate SSE event after every reply
// ---------------------------------------------------------------------------

const FOLLOWUP_SYSTEM = `You are the follow-up question suggester for an agentic database-analysis assistant.
Given what the user just asked and what the agents produced, suggest 2-3 SHORT questions the user might want to ask next.

Rules:
- Return ONLY a JSON object: { "questions": ["...", "...", "..."] }
- 2-3 questions, max 14 words each.
- Plain English. No jargon. A non-expert should find them natural.
- Each question should follow naturally from what was just shown — e.g. after a "top products" chart, suggest "Who bought these products the most?".
- If the user just got a report, suggest questions that drill into specific patterns the report surfaced.
- If the user just got an error or a schema lookup, suggest the most natural next step.
- Never repeat the user's original question verbatim.`;

export async function suggestFollowUps(
  state: AgentState,
  canvas: CanvasObject[],
  reply: string
): Promise<string[]> {
  // Skip for very short / empty replies (greetings, errors with no useful context).
  if (!reply || reply.length < 30) return [];

  const recent = state.messages.slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n");
  const canvasSection = canvas.length
    ? canvas.map((c, i) => `[${i + 1}] ${describeCanvas(c)}`).join("\n")
    : "(no canvas artifacts)";

  const userPrompt = `User's question:
"""${state.userInput}"""

Recent conversation:
${recent || "(none)"}

Assistant's reply (just produced):
"""${reply.slice(0, 800)}"""

Canvas artifacts the user is looking at:
${canvasSection}

Suggest 2-3 follow-up questions. Return ONLY JSON.`;

  try {
    const out = await completeJson<{ questions: string[] }>(
      [
        { role: "system", content: FOLLOWUP_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.5, maxTokens: 200 }
    );
    const questions = Array.isArray(out.questions) ? out.questions.slice(0, 3) : [];
    // Sanitise — strip leading bullets, trim, cap length.
    return questions
      .map((q) => String(q).replace(/^[-*]\s*/, "").trim())
      .filter((q) => q.length > 0 && q.length <= 120);
  } catch {
    // Degrade silently — follow-ups are a "nice to have", not critical.
    return [];
  }
}
