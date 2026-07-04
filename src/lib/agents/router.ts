/**
 * Router node (spec §5).
 *
 * Classifies the user's message into the set of capabilities needed this
 * turn: schema, sql, eda, viz, ml, or just conversation. A single fast,
 * structured-output LLM call. This is the only node that decides WHICH
 * agents run — the user never picks.
 */
import { completeJson } from "@/lib/llm";
import type { AgentName, AgentState } from "@/lib/types";
import { renderSchema } from "./schema-utils";

export interface RouterOutput {
  agents: AgentName[];
  reasoning: string;
}

const SYSTEM = `You are the router for an agentic database-analysis assistant.
Given the user's latest message, decide which specialist agents must run this turn.

Available agents (besides yourself):
- "schema": answer questions about table/column structure, list tables, describe a table.
- "sql": run a SQL query against the connected database to fetch or compute data.
- "eda": compute summary statistics / distributions / profiling on a result set.
- "viz": build a chart (Vega-Lite) from a result set.
- "ml": run a lightweight model (linear regression, k-means clustering, simple forecast).

Rules:
- Return ONLY a JSON object: { "agents": ["..."], "reasoning": "..." }
- "agents" must be an ordered list drawn ONLY from: schema, sql, eda, viz, ml.
- Omit "synthesis" — it always runs last and you must never include it.
- If the user only asks a general/conversational question with no data need, return an EMPTY agents list [].
- If the user asks "how many / list / show me / what is the total / top N / breakdown / average", include "sql".
- If the user explicitly says "summarize / profile / statistics / EDA", include "eda" (and "sql" if data isn't already available).
- If the user says "distribution / histogram / spread / spread of / distribution of", include BOTH "eda" AND "viz" (and "sql" if data isn't available) — a distribution is best shown as a histogram chart plus summary stats.
- If the user says "chart / plot / visualize / graph / bar / line / scatter / pie", include "viz" (and "sql" if data isn't available).
- If the user says "forecast / predict / cluster / regression / model / classify / ML", include "ml" (and "sql" if data isn't available).
- A pure schema lookup ("what tables", "describe orders") needs ONLY "schema".
- When unsure whether data is needed, prefer including "sql".
- Keep "reasoning" to one short sentence.`;

export async function runRouter(state: AgentState): Promise<RouterOutput> {
  // Fast path: empty schema or a clearly conversational message → no agents.
  const trivial = /^(hi|hello|hey|thanks|thank you|ok|okay|cool|nice)\b/i.test(state.userInput.trim());
  if (trivial && state.userInput.trim().split(/\s+/).length <= 3) {
    return { agents: [], reasoning: "Conversational greeting — no data needed." };
  }

  const schemaText = state.schemaSnapshot
    ? renderSchema(state.schemaSnapshot).slice(0, 6000)
    : "(no schema available yet)";

  const history = state.messages
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const userPrompt = `Database dialect: ${state.dialect}

Schema:
${schemaText}

Recent conversation:
${history || "(none)"}

User's latest message:
"""${state.userInput}"""

Decide which agents to run. Remember: return ONLY JSON.`;

  try {
    const out = await completeJson<RouterOutput>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1 }
    );
    // Sanitise: drop unknowns and synthesis, dedupe, preserve order.
    const allowed: AgentName[] = ["schema", "sql", "eda", "viz", "ml"];
    const seen = new Set<AgentName>();
    const agents = (out.agents || [])
      .filter((a): a is AgentName => allowed.includes(a))
      .filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
    return { agents, reasoning: out.reasoning || "" };
  } catch (e) {
    // Degrade gracefully: assume a data query is wanted.
    return {
      agents: ["sql"],
      reasoning: `Router fallback (parse error): assuming a SQL query is needed. ${(e as Error).message}`,
    };
  }
}
