/**
 * Visualization agent (spec §5).
 *
 * Given a dataframe and the user's intent, decides an appropriate chart type
 * and produces a **Vega-Lite JSON spec** referencing the data inline. We
 * deliberately do NOT have this agent write plotting code (spec §3 safety):
 * the spec is declarative JSON the frontend renders directly, and we validate
 * it before sending it on.
 */
import { completeJson } from "@/lib/llm";
import type { AgentState, CanvasObject, ChartCanvasObject } from "@/lib/types";
import { getFrame } from "@/lib/frame-cache";

export interface VizAgentOutput {
  reply: string;
  canvas: CanvasObject[];
}

const SYSTEM = `You are the visualization agent for a database-analysis assistant.
You produce a Vega-Lite v6 chart specification as a single JSON object that
references an inline "values" dataset. You do NOT write code.

Output format — return ONLY a JSON object with exactly these keys:
{
  "title": "short chart title",
  "description": "one-line description for accessibility",
  "mark": { "type": "bar|line|point|area|circle|square|tick|rect|arc", "tooltip": true },
  "encoding": { ... vega-lite encoding ... },
  "caption": "one short sentence explaining what the chart shows"
}

Rules:
1. Inspect the provided columns and sample rows carefully. Pick a mark that fits:
   - One categorical + one quantitative → bar (or column).
   - A date/time + a quantitative → line or area.
   - Two quantitative → point/scatter.
   - A quantitative distribution → use "bar" with a binned x, OR "area" with a density transform.
   - Part-of-whole → "arc" (pie) only when there are few categories; otherwise stacked bar.
2. Always set a title, an x and/or y encoding, and "tooltip": true.
3. Reference column names EXACTLY as given — they are case-sensitive.
4. For large value ranges, add "scale": { "type": "sqrt" } where it helps.
5. Never include a "data" key — the orchestrator injects the dataset inline as "values" for you.
6. Keep the spec minimal and valid. No transforms unless genuinely needed.`;

export async function runVizAgent(state: AgentState): Promise<VizAgentOutput> {
  const frame = state.lastResultId ? getFrame(state.lastResultId) : undefined;
  if (!frame) {
    return { reply: "I need a result set to chart. Ask a question that returns some data first.", canvas: [] };
  }
  if (!frame.rows.length) {
    return { reply: "The query returned no rows, so there's nothing to chart.", canvas: [] };
  }

  const sampleRows = frame.rows.slice(0, 6);
  const cols = frame.columns.map((c) => `${c.name} (${c.dtype || inferType(frame.rows[0]?.[c.name])})`).join(", ");

  let spec: Record<string, unknown>;
  let title = "Chart";
  let caption = "";
  try {
    const out = await completeJson<{ title: string; description: string; mark: unknown; encoding: unknown; caption?: string }>(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `User question: ${state.userInput}

Available columns: ${cols}

Sample rows (JSON):
${JSON.stringify(sampleRows, null, 2)}

Total rows available: ${frame.rowCount}

Decide the best chart type and return ONLY the JSON spec. Remember: do NOT include a "data" key.`,
        },
      ],
      { temperature: 0.2 }
    );
    spec = { mark: out.mark, encoding: out.encoding };
    title = out.title || "Chart";
    caption = out.caption || out.description || "";
  } catch (e) {
    // Graceful fallback: a simple bar of the first categorical × first numeric column.
    spec = fallbackSpec(frame);
    title = "Chart";
    caption = `Auto-generated chart (the model returned an invalid spec: ${(e as Error).message}).`;
  }

  // Inject the dataset inline and validate minimally.
  spec = { ...spec, data: { values: frame.rows.slice(0, 1000) } };
  if (!validateSpec(spec)) {
    spec = fallbackSpec(frame);
    spec = { ...spec, data: { values: frame.rows.slice(0, 1000) } };
    caption = caption || "Showing a default chart because the generated spec was malformed.";
  }

  const obj: ChartCanvasObject = { type: "chart", title, spec, caption };
  return {
    reply: `Built a **${typeof spec.mark === "object" && spec.mark ? (spec.mark as { type?: string }).type : spec.mark}** chart from ${frame.rowCount.toLocaleString()} rows.`,
    canvas: [obj],
  };
}

function inferType(v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
}

function validateSpec(spec: Record<string, unknown>): boolean {
  if (!spec || typeof spec !== "object") return false;
  if (!spec.mark) return false;
  if (!spec.encoding) return false;
  // Must reference at least one real field present in the data.
  const enc = spec.encoding as Record<string, unknown>;
  const values = (spec.data as { values?: Record<string, unknown>[] })?.values;
  const availableFields = values && values.length ? new Set(Object.keys(values[0])) : new Set<string>();
  for (const channel of Object.values(enc)) {
    const field = (channel as { field?: string })?.field;
    if (field && availableFields.size && !availableFields.has(field)) {
      return false;
    }
  }
  return true;
}

function fallbackSpec(frame: { columns: { name: string }[]; rows: Record<string, unknown>[] }): Record<string, unknown> {
  const cols = frame.columns.map((c) => c.name);
  const firstNumeric = cols.find((c) => frame.rows.some((r) => typeof Number(r[c]) === "number" && !Number.isNaN(Number(r[c])))) || cols[0];
  const firstCategorical = cols.find((c) => c !== firstNumeric) || cols[0];
  return {
    mark: { type: "bar", tooltip: true },
    encoding: {
      x: { field: firstCategorical, type: "nominal" },
      y: { field: firstNumeric, type: "quantitative", aggregate: "sum" },
      color: { field: firstCategorical, type: "nominal", legend: null },
    },
  };
}
