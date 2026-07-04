/**
 * EDA agent (spec §5).
 *
 * Given a dataframe, computes summary statistics, null counts, distributions,
 * and simple correlations — the pandas-profiling equivalent, in pure TS.
 * Produces both a structured summary object (for the canvas) and a short
 * natural-language narrative (for chat). No LLM call needed for the stats;
 * we use the LLM only to turn the numbers into a short insight paragraph.
 */
import { complete } from "@/lib/llm";
import type { AgentState, CanvasObject, EdaSummaryCanvasObject, EdaColumnStats } from "@/lib/types";
import { getFrame } from "@/lib/frame-cache";

export interface EdaAgentOutput {
  reply: string;
  canvas: CanvasObject[];
}

export async function runEdaAgent(state: AgentState): Promise<EdaAgentOutput> {
  const frameId = state.lastResultId;
  const frame = frameId ? getFrame(frameId) : undefined;
  if (!frame) {
    return {
      reply: "I don't have a dataset to profile yet. Ask a question that retrieves some data first.",
      canvas: [],
    };
  }

  const columnStats: EdaColumnStats[] = frame.columns.map((c) => {
    const values = frame.rows.map((r) => r[c.name]);
    return profileColumn(c.name, c.dtype || typeof values[0], values);
  });

  // Top correlations between numeric columns (cheap Pearson).
  const numericCols = columnStats.filter((c) => c.mean !== null && c.mean !== undefined && c.std !== undefined && (c.std ?? 0) > 0);
  const correlations: string[] = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = frame.rows.map((r) => Number(r[numericCols[i].name]));
      const b = frame.rows.map((r) => Number(r[numericCols[j].name]));
      const r = pearson(a, b);
      if (Math.abs(r) > 0.5) {
        correlations.push(
          `- **${numericCols[i].name}** ↔ **${numericCols[j].name}**: r = ${r.toFixed(2)} (${describeCorrelation(r)})`
        );
      }
    }
  }

  const summary: EdaSummaryCanvasObject = {
    type: "eda_summary",
    title: `Statistical summary (${frame.rowCount.toLocaleString()} rows, ${frame.columns.length} columns)`,
    columns: columnStats,
    insights: correlations,
  };

  // Short natural-language narrative via the LLM.
  const compact = columnStats
    .map((c) => {
      const parts = [`${c.name} (${c.dtype})`];
      parts.push(`nulls ${c.nullPct.toFixed(1)}%`);
      parts.push(`unique ${c.unique}`);
      if (c.mean !== null && c.mean !== undefined) {
        parts.push(`min ${c.min} / mean ${round(c.mean)} / median ${round(c.median)} / max ${c.max} (std ${round(c.std)})`);
      } else if (c.topValues?.length) {
        parts.push(`top: ${c.topValues.slice(0, 3).map((v) => `${v.value}×${v.count}`).join(", ")}`);
      }
      return `- ${parts.join(", ")}`;
    })
    .join("\n");

  let reply: string;
  try {
    reply = await complete(
      [
        {
          role: "system",
          content:
            "You are the EDA agent. Turn raw column statistics into a concise 2-4 sentence insight paragraph for the user. Mention notable nulls, skew, ranges, and any strong correlations provided. Use plain language; no markdown headers.",
        },
        {
          role: "user",
          content: `Question: ${state.userInput}\n\nColumn statistics:\n${compact}\n\nStrong correlations:\n${correlations.join("\n") || "none above 0.5"}`,
        },
      ],
      { temperature: 0.3 }
    );
  } catch {
    reply = `Profiled ${frame.columns.length} columns across ${frame.rowCount.toLocaleString()} rows. ` +
      (correlations.length ? `Notable correlations: ${correlations.join("; ")}.` : "No strong correlations detected.");
  }

  return { reply, canvas: [summary] };
}

// ---------------------------------------------------------------------------
// Pure-TS profiling helpers
// ---------------------------------------------------------------------------

function profileColumn(name: string, dtype: string, values: unknown[]): EdaColumnStats {
  const count = values.length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  const nulls = count - nonNull.length;
  const nullPct = count ? (nulls / count) * 100 : 0;

  // Numeric?
  const nums = nonNull.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  const isNumeric = nums.length >= nonNull.length * 0.8;

  const uniqueSet = new Set(nonNull.map((v) => String(v)));
  const unique = uniqueSet.size;

  if (isNumeric && nums.length) {
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const std = Math.sqrt(variance);
    return {
      name,
      dtype: "number",
      count,
      nulls,
      nullPct,
      unique,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean,
      median: percentile(sorted, 0.5),
      std,
    };
  }

  // Categorical: top values.
  const freq = new Map<string, number>();
  for (const v of nonNull) {
    const key = String(v);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const topValues = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, c]) => ({ value, count: c }));

  return {
    name,
    dtype: dtype || "text",
    count,
    nulls,
    nullPct,
    unique,
    topValues,
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

function describeCorrelation(r: number): string {
  const a = Math.abs(r);
  if (a > 0.8) return r > 0 ? "strong positive" : "strong negative";
  if (a > 0.5) return r > 0 ? "moderate positive" : "moderate negative";
  return "weak";
}

function round(x: number | null | undefined): number | null {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  return Math.round(x * 1000) / 1000;
}
