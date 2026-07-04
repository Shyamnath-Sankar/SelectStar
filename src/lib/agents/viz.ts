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
   - A single quantitative column (distribution request) → use "bar" with "x": { "field": "<col>", "type": "quantitative", "bin": true } and "y": { "aggregate": "count", "type": "quantitative" }. This produces a histogram.
   - A quantitative distribution over categories → "bar" with a binned x.
   - Part-of-whole → "arc" (pie) only when there are few categories; otherwise stacked bar.
2. Always set a title, an x and/or y encoding, and "tooltip": true.
3. Reference column names EXACTLY as given — they are case-sensitive.
4. For large value ranges, add "scale": { "type": "sqrt" } where it helps.
5. Never include a "data" key — the orchestrator injects the dataset inline as "values" for you.
6. Keep the spec minimal and valid. No transforms unless genuinely needed.
7. For HISTOGRAMS (distribution of a single numeric column): the encoding MUST be:
   "encoding": { "x": { "field": "<column>", "type": "quantitative", "bin": true }, "y": { "aggregate": "count", "type": "quantitative" } }
   Do NOT put "field" in the y channel for a histogram — use "aggregate": "count" only.`;

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
    // Graceful fallback: pick a sensible chart based on the data shape.
    spec = smartFallbackSpec(frame, state.userInput);
    title = "Chart";
    caption = `Auto-generated chart (the model returned an invalid spec: ${(e as Error).message}).`;
  }

  // Inject the dataset inline and validate minimally.
  spec = { ...spec, data: { values: frame.rows.slice(0, 1000) } };
  if (!validateSpec(spec)) {
    spec = smartFallbackSpec(frame, state.userInput);
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

/**
 * Smart fallback that picks a sensible chart based on the data shape:
 *  - Single numeric column → histogram (binned x, count y)
 *  - Single categorical column → bar chart of counts
 *  - Date + numeric → line chart
 *  - Categorical + numeric → bar chart (sum)
 *  - Two numeric → scatter
 */
function smartFallbackSpec(frame: { columns: { name: string }[]; rows: Record<string, unknown>[] }, question: string): Record<string, unknown> {
  const cols = frame.columns.map((c) => c.name);
  const numericCols = cols.filter((c) => frame.rows.some((r) => {
    const v = Number(r[c]);
    return !Number.isNaN(v);
  }));
  const dateCols = cols.filter((c) => frame.rows.some((r) => typeof r[c] === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(r[c]))));
  const categoricalCols = cols.filter((c) => !numericCols.includes(c) && !dateCols.includes(c));
  const isDistribution = /distribut|histogram|spread/i.test(question);

  // Single numeric column → histogram
  if (numericCols.length >= 1 && (cols.length === 1 || isDistribution)) {
    return {
      mark: { type: "bar", tooltip: true },
      encoding: {
        x: { field: numericCols[0], type: "quantitative", bin: true },
        y: { aggregate: "count", type: "quantitative" },
      },
    };
  }
  // Date + numeric → line
  if (dateCols.length >= 1 && numericCols.length >= 1) {
    return {
      mark: { type: "line", tooltip: true },
      encoding: {
        x: { field: dateCols[0], type: "temporal" },
        y: { field: numericCols[0], type: "quantitative", aggregate: "sum" },
      },
    };
  }
  // Categorical + numeric → bar
  if (categoricalCols.length >= 1 && numericCols.length >= 1) {
    return {
      mark: { type: "bar", tooltip: true },
      encoding: {
        x: { field: categoricalCols[0], type: "nominal" },
        y: { field: numericCols[0], type: "quantitative", aggregate: "sum" },
        color: { field: categoricalCols[0], type: "nominal", legend: null },
      },
    };
  }
  // Single categorical → bar of counts
  if (categoricalCols.length >= 1) {
    return {
      mark: { type: "bar", tooltip: true },
      encoding: {
        x: { field: categoricalCols[0], type: "nominal" },
        y: { aggregate: "count", type: "quantitative" },
      },
    };
  }
  // Two numeric → scatter
  if (numericCols.length >= 2) {
    return {
      mark: { type: "circle", tooltip: true },
      encoding: {
        x: { field: numericCols[0], type: "quantitative" },
        y: { field: numericCols[1], type: "quantitative" },
      },
    };
  }
  // Ultimate fallback
  return {
    mark: { type: "bar", tooltip: true },
    encoding: {
      x: { field: cols[0], type: "nominal" },
      y: { aggregate: "count", type: "quantitative" },
    },
  };
}
