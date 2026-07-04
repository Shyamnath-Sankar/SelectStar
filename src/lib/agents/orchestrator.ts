/**
 * Orchestrator (spec §5 — "LangGraph" equivalent in TypeScript).
 *
 * Models the agent flow as a graph with a shared `AgentState`:
 *
 *   user message
 *        │
 *        ▼
 *     ROUTER ──┬─(agents includes "schema")─▶ SCHEMA ─┐
 *             ├─(sql)─▶ SQL ──┬─(write gated)─▶ (stop, await confirm)
 *             │              └─(ok)─▶ ┬─(eda)─▶ EDA ─┐
 *             │                       ├─(viz)─▶ VIZ ─┤
 *             │                       └─(ml)──▶ ML ──┤
 *             └─(none)──────────────────────────────►│
 *                                                    ▼
 *                                              SYNTHESIS (stream)
 *
 * Conditional edges are decided by the router's classification. EDA/Viz/ML
 * run in parallel after SQL when the router asked for them. The synthesis
 * node is the only one that produces user-facing prose; specialists emit
 * structured canvas objects + short internal summaries.
 *
 * The orchestrator emits StreamEvents to the caller (the SSE route) so the
 * frontend can render intermediate state ("Running query…") and stream the
 * final reply token-by-token.
 */
import type { AgentState, StreamEvent, CanvasObject, AgentName } from "@/lib/types";
import { runRouter } from "./router";
import { runSchemaAgent } from "./schema";
import { runSqlAgent } from "./sql";
import { runEdaAgent } from "./eda";
import { runVizAgent } from "./viz";
import { runMlAgent } from "./ml";
import { runSynthesis } from "./synthesis";
import { getFrame } from "@/lib/frame-cache";

export interface OrchestratorCallbacks {
  emit: (event: StreamEvent) => void;
  /** Persist a canvas object (the route flushes to DB). */
  onCanvas: (object: CanvasObject) => void;
  /** Update the in-memory agent state (e.g. lastResultId, pendingWrite). */
  onStatePatch: (patch: Partial<AgentState>) => void;
}

export async function runTurn(
  initialState: AgentState,
  cb: OrchestratorCallbacks
): Promise<AgentState> {
  let state = { ...initialState, canvasObjects: [], steps: [] };

  // ---- 1. Router --------------------------------------------------------
  cb.emit({ type: "step", agent: "router", label: "Understanding your question…" });
  const route = await runRouter(state);
  state.routedAgents = route.agents;
  state.steps.push({ agent: "router", label: route.reasoning || "Routed", ts: Date.now() });

  // Short-circuit: no agents → just synthesize a conversational reply.
  if (route.agents.length === 0) {
    const reply = await runSynthesis(
      state,
      [{ agent: "router", summary: `No specialist agents needed. ${route.reasoning}` }],
      [],
      (delta) => cb.emit({ type: "token", text: delta })
    );
    cb.emit({ type: "reply_done", reply });
    return { ...state, reply };
  }

  const agentSummaries: { agent: string; summary: string }[] = [];
  const canvas: CanvasObject[] = [];

  // ---- 2. Schema agent (if requested) ----------------------------------
  if (route.agents.includes("schema")) {
    cb.emit({ type: "step", agent: "schema", label: "Looking at the schema…" });
    const out = await runSchemaAgent(state);
    if (out.reply) agentSummaries.push({ agent: "schema", summary: out.reply });
    for (const obj of out.canvas) {
      canvas.push(obj);
      cb.onCanvas(obj);
      cb.emit({ type: "canvas", object: obj });
    }
    state.steps.push({ agent: "schema", label: "Schema reviewed", ts: Date.now() });
  }

  // ---- 3. SQL agent (if requested) -------------------------------------
  let sqlRanSelect = false;
  if (route.agents.includes("sql")) {
    cb.emit({ type: "step", agent: "sql", label: "Writing a SQL query…" });
    // Pass the downstream agents so the SQL agent knows whether to return
    // raw rows (for EDA/viz/ML) or may use aggregates (sql-only turns).
    const downstream = route.agents.filter((a) => a !== "sql");
    const out = await runSqlAgent(state, downstream);
    if (out.error && !out.pending) {
      agentSummaries.push({ agent: "sql", summary: `SQL failed: ${out.error}` });
    } else if (out.pending) {
      agentSummaries.push({
        agent: "sql",
        summary: `Generated a write statement gated behind Zen-mode confirmation. Estimated impact: ${out.pending.estimatedImpact}`,
      });
      state.pendingWrite = out.pending;
      cb.onStatePatch({ pendingWrite: out.pending });
    } else if (out.result) {
      agentSummaries.push({
        agent: "sql",
        summary: `Executed a SELECT returning ${out.result.rowCount} rows in ${out.result.durationMs}ms. Columns: ${out.result.columns.map((c) => c.name).join(", ")}.`,
      });
      if (out.result.frameId) {
        state.lastResultId = out.result.frameId;
        cb.onStatePatch({ lastResultId: out.result.frameId });
      }
      sqlRanSelect = true;
    }
    for (const obj of out.canvas) {
      canvas.push(obj);
      cb.onCanvas(obj);
      cb.emit({ type: "canvas", object: obj });
      // Emit a dedicated sql event so the UI can highlight the SQL block.
      if (obj.type === "sql") {
        cb.emit({ type: "sql", query: obj.query, executed: obj.executed, rowCount: obj.rowCount, durationMs: obj.durationMs, error: obj.error });
      }
    }
    state.steps.push({
      agent: "sql",
      label: out.pending ? "Write generated — awaiting confirmation" : sqlRanSelect ? "Query executed" : out.error ? "Query failed" : "Done",
      ts: Date.now(),
    });

    // If a write is pending, stop here — synthesis will tell the user to confirm.
    if (out.pending) {
      const reply = await runSynthesis(state, agentSummaries, canvas, (delta) =>
        cb.emit({ type: "token", text: delta })
      );
      cb.emit({ type: "reply_done", reply });
      return { ...state, reply, canvasObjects: canvas };
    }
  }

  // ---- 4. EDA / Viz / ML — parallel after a successful SELECT ----------
  const downstream: AgentName[] = [];
  if (route.agents.includes("eda")) downstream.push("eda");
  if (route.agents.includes("viz")) downstream.push("viz");
  if (route.agents.includes("ml")) downstream.push("ml");

  if (downstream.length && sqlRanSelect) {
    // Emit step labels first so the UI shows them as "in progress".
    for (const a of downstream) {
      const label =
        a === "eda" ? "Profiling the data…" :
        a === "viz" ? "Building a chart…" :
        "Running a model…";
      cb.emit({ type: "step", agent: a, label });
    }

    const results = await Promise.all(
      downstream.map(async (a) => {
        try {
          if (a === "eda") return { agent: "eda", out: await runEdaAgent(state) };
          if (a === "viz") return { agent: "viz", out: await runVizAgent(state) };
          return { agent: "ml", out: await runMlAgent(state) };
        } catch (e) {
          return { agent: a, out: { reply: `Agent ${a} failed: ${(e as Error).message}`, canvas: [] } };
        }
      })
    );

    for (const r of results) {
      const out = r.out as { reply: string; canvas: CanvasObject[] };
      if (out.reply) agentSummaries.push({ agent: r.agent, summary: out.reply });
      for (const obj of out.canvas) {
        canvas.push(obj);
        cb.onCanvas(obj);
        cb.emit({ type: "canvas", object: obj });
      }
      state.steps.push({ agent: r.agent as AgentName, label: `${r.agent} done`, ts: Date.now() });
    }
  } else if (downstream.length && !sqlRanSelect) {
    // Downstream agents were requested but no data was retrieved.
    agentSummaries.push({
      agent: "orchestrator",
      summary: "EDA/Viz/ML were requested but no query result was available to analyse. The user may need to ask a data-retrieving question first.",
    });
  }

  // ---- 5. Synthesis -----------------------------------------------------
  cb.emit({ type: "step", agent: "synthesis", label: "Writing your answer…" });
  const reply = await runSynthesis(state, agentSummaries, canvas, (delta) =>
    cb.emit({ type: "token", text: delta })
  );
  cb.emit({ type: "reply_done", reply });

  return { ...state, reply, canvasObjects: canvas };
}

/** Convenience: was a result frame produced and is it still cached? */
export function hasResultFrame(state: AgentState): boolean {
  return !!(state.lastResultId && getFrame(state.lastResultId));
}
