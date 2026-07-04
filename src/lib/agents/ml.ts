/**
 * ML agent (spec §5).
 *
 * Only triggered on explicit request (forecasting, clustering, classification,
 * simple regression). Uses lightweight pure-TS implementations of:
 *  - ordinary least-squares linear regression
 *  - k-means clustering
 *  - moving-average + linear-trend forecasting
 *
 * Returns a structured result object (metrics, predictions / cluster
 * assignments) plus a plain-language explanation. Never silently invoked for
 * a normal "show me the data" question — modeling is opt-in via the router.
 */
import { completeJson } from "@/lib/llm";
import type { AgentState, CanvasObject, ModelResultCanvasObject } from "@/lib/types";
import { getFrame } from "@/lib/frame-cache";

export interface MlAgentOutput {
  reply: string;
  canvas: CanvasObject[];
}

const SYSTEM = `You are the ML agent for a database-analysis assistant. You decide which lightweight model fits the user's request and the available columns, and you describe your choice in plain language.

You do NOT run the model yourself — the runtime does. You only pick parameters.

Output ONLY JSON: { "task": "regression|clustering|forecast|none", "target": "<column name or null>", "features": ["<cols>"], "nClusters": <int|null>, "forecastHorizon": <int|null>, "reasoning": "<one sentence>" }

Rules:
- "regression": pick one numeric "target" and 1-3 numeric "features" from the columns.
- "clustering": pick 2-3 numeric "features" and an "nClusters" between 2 and 6. "target" is null.
- "forecast": pick a date-like column as the first feature and a numeric "target"; set "forecastHorizon" (3-12).
- "none": if the data clearly doesn't support the request, return task "none" with a short reason.`;

export async function runMlAgent(state: AgentState): Promise<MlAgentOutput> {
  const frame = state.lastResultId ? getFrame(state.lastResultId) : undefined;
  if (!frame || !frame.rows.length) {
    return { reply: "I need a dataset to model. Ask a question that returns some data first.", canvas: [] };
  }

  const cols = frame.columns.map((c) => `${c.name} (${c.dtype || inferType(frame.rows[0]?.[c.name])})`).join(", ");
  const sample = frame.rows.slice(0, 5);

  let plan: {
    task: "regression" | "clustering" | "forecast" | "none";
    target: string | null;
    features: string[];
    nClusters: number | null;
    forecastHorizon: number | null;
    reasoning: string;
  };
  try {
    plan = await pick(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `User request: ${state.userInput}\n\nColumns: ${cols}\n\nSample rows:\n${JSON.stringify(sample, null, 2)}\n\nReturn ONLY JSON.`,
        },
      ]
    );
  } catch (e) {
    return { reply: `I couldn't plan a model for this request: ${(e as Error).message}`, canvas: [] };
  }

  if (plan.task === "none") {
    return { reply: plan.reasoning || "This dataset doesn't support the requested modeling task.", canvas: [] };
  }

  try {
    if (plan.task === "regression") return runRegression(frame, plan);
    if (plan.task === "clustering") return runClustering(frame, plan);
    if (plan.task === "forecast") return runForecast(frame, plan);
    return { reply: "Unsupported modeling task.", canvas: [] };
  } catch (e) {
    return { reply: `Modeling failed: ${(e as Error).message}`, canvas: [] };
  }
}

async function pick(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  return completeJson<{
    task: "regression" | "clustering" | "forecast" | "none";
    target: string | null;
    features: string[];
    nClusters: number | null;
    forecastHorizon: number | null;
    reasoning: string;
  }>(messages, { temperature: 0.1 });
}

// ---------------------------------------------------------------------------
// Linear regression (ordinary least squares via normal equations)
// ---------------------------------------------------------------------------

function runRegression(frame: { columns: { name: string }[]; rows: Record<string, unknown>[] }, plan: { target: string | null; features: string[] }): MlAgentOutput {
  const target = plan.target!;
  const feats = plan.features.slice(0, 3);
  if (!target || !feats.length) return { reply: "Regression needs a target and at least one feature.", canvas: [] };

  const X = frame.rows.map((r) => feats.map((f) => Number(r[f])));
  const y = frame.rows.map((r) => Number(r[target]));
  const n = y.length;
  if (n < feats.length + 2) return { reply: `Not enough rows (${n}) for regression with ${feats.length} features.`, canvas: [] };

  const { weights, intercept, r2 } = ols(X, y);
  const predictions = X.map((x) => weights.reduce((s, w, i) => s + w * x[i], intercept));
  const mae = meanAbsError(y, predictions);

  const result: ModelResultCanvasObject = {
    type: "model_result",
    title: `Linear regression — ${target} ~ ${feats.join(" + ")}`,
    modelType: "linear_regression",
    metrics: { r2: round(r2), mae: round(mae), n, intercept: round(intercept) },
    predictions: {
      columns: [
        ...feats.map((f) => ({ name: f, dtype: "number" })),
        { name: target, dtype: "number" },
        { name: "predicted", dtype: "number" },
      ],
      rows: frame.rows.slice(0, 200).map((r, i) => {
        const row: Record<string, unknown> = {};
        feats.forEach((f) => (row[f] = r[f]));
        row[target] = r[target];
        row.predicted = Math.round(predictions[i] * 100) / 100;
        return row;
      }),
    },
    explanation: `Fit an ordinary least-squares model on ${n} rows. R² = ${round(r2).toFixed(3)} (closer to 1 is better). Mean absolute error ≈ ${round(mae).toFixed(2)}. Intercept ≈ ${round(intercept).toFixed(2)}; weights: ${feats.map((f, i) => `${f}=${round(weights[i]).toFixed(3)}`).join(", ")}.`,
  };
  return { reply: result.explanation!, canvas: [result] };
}

function ols(X: number[][], y: number[]): { weights: number[]; intercept: number; r2: number } {
  const n = X.length;
  const k = X[0].length;
  // Add intercept column.
  const Xa = X.map((row) => [1, ...row]);
  // Normal equations: beta = (XᵀX)⁻¹ Xᵀy
  const XtX = matMul(transpose(Xa), Xa);
  const Xty = matVec(transpose(Xa), y);
  const beta = solve(XtX, Xty);
  const intercept = beta[0];
  const weights = beta.slice(1);
  // R²
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = Xa[i].reduce((s, v, j) => s + v * beta[j], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { weights, intercept, r2 };
}

// ---------------------------------------------------------------------------
// K-means clustering
// ---------------------------------------------------------------------------

function runClustering(frame: { columns: { name: string }[]; rows: Record<string, unknown>[] }, plan: { features: string[]; nClusters: number | null }): MlAgentOutput {
  const feats = plan.features.slice(0, 3);
  const k = Math.max(2, Math.min(6, plan.nClusters ?? 3));
  if (!feats.length) return { reply: "Clustering needs at least one feature.", canvas: [] };

  const raw = frame.rows.map((r) => feats.map((f) => Number(r[f])));
  const n = raw.length;
  if (n < k) return { reply: `Not enough rows (${n}) for ${k} clusters.`, canvas: [] };

  // Standardise features.
  const means = feats.map((_, j) => raw.reduce((s, r) => s + r[j], 0) / n);
  const stds = feats.map((_, j) => Math.sqrt(raw.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n) || 1);
  const X = raw.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));

  const { assignments, centroids, iterations } = kmeans(X, k);
  // Silhouette-ish compactness: average distance to own centroid.
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    const c = centroids[assignments[i]];
    inertia += Math.sqrt(X[i].reduce((s, v, j) => s + (v - c[j]) ** 2, 0));
  }
  inertia /= n;

  const result: ModelResultCanvasObject = {
    type: "model_result",
    title: `K-means clustering (k=${k}) on ${feats.join(", ")}`,
    modelType: "kmeans",
    metrics: { k, n, iterations, inertia: round(inertia) },
    predictions: {
      columns: [...feats.map((f) => ({ name: f, dtype: "number" })), { name: "cluster", dtype: "number" }],
      rows: frame.rows.slice(0, 200).map((r, i) => {
        const row: Record<string, unknown> = {};
        feats.forEach((f) => (row[f] = r[f]));
        row.cluster = assignments[i];
        return row;
      }),
    },
    explanation: `Grouped ${n} rows into ${k} clusters using standardised ${feats.join(", ")}. Converged in ${iterations} iterations; average within-cluster distance ≈ ${round(inertia).toFixed(2)} (lower is tighter).`,
  };
  return { reply: result.explanation!, canvas: [result] };
}

function kmeans(X: number[][], k: number): { assignments: number[]; centroids: number[][]; iterations: number } {
  const n = X.length;
  const dim = X[0].length;
  // K-means++ init.
  const centroids: number[][] = [X[Math.floor(Math.random() * n)].slice()];
  while (centroids.length < k) {
    const dists = X.map((x) => Math.min(...centroids.map((c) => dist(x, c))) ** 2);
    const total = dists.reduce((a, b) => a + b, 0);
    const r = Math.random() * total;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += dists[i];
      if (acc >= r) { centroids.push(X[i].slice()); break; }
    }
  }
  const assignments = new Array(n).fill(0);
  let iterations = 0;
  for (let iter = 0; iter < 50; iter++) {
    iterations++;
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(X[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    // Recompute centroids.
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[assignments[i]]++;
      for (let j = 0; j < dim; j++) sums[assignments[i]][j] += X[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      for (let j = 0; j < dim; j++) centroids[c][j] = sums[c][j] / counts[c];
    }
    if (!changed && iter > 0) break;
  }
  return { assignments, centroids, iterations };
}

// ---------------------------------------------------------------------------
// Simple forecast: linear trend + moving-average residual
// ---------------------------------------------------------------------------

function runForecast(frame: { columns: { name: string }[]; rows: Record<string, unknown>[] }, plan: { target: string | null; features: string[]; forecastHorizon: number | null }): MlAgentOutput {
  const target = plan.target!;
  const dateCol = plan.features[0];
  const horizon = Math.max(1, Math.min(12, plan.forecastHorizon ?? 6));
  if (!target || !dateCol) return { reply: "Forecast needs a date column and a numeric target.", canvas: [] };

  // Sort by date ascending.
  const sorted = [...frame.rows].sort((a, b) => String(a[dateCol]).localeCompare(String(b[dateCol])));
  const y = sorted.map((r) => Number(r[target]));
  const n = y.length;
  if (n < 4) return { reply: `Not enough data points (${n}) to forecast.`, canvas: [] };

  // Aggregate by date in case of duplicates.
  const byDate = new Map<string, number>();
  sorted.forEach((r) => {
    const d = String(r[dateCol]);
    byDate.set(d, (byDate.get(d) ?? 0) + Number(r[target]));
  });
  const dates = [...byDate.keys()].sort();
  const series = dates.map((d) => byDate.get(d)!);
  const m = series.length;

  // Linear trend on the series index.
  const xs = series.map((_, i) => i);
  const { slope, intercept } = linreg(xs, series);
  const trend = xs.map((x) => slope * x + intercept);

  // Forecast next `horizon` points.
  const forecast: { date: string; value: number }[] = [];
  const lastDate = new Date(dates[dates.length - 1]);
  for (let h = 1; h <= horizon; h++) {
    const next = new Date(lastDate);
    next.setDate(next.getDate() + h * guessStepDays(dates));
    const v = slope * (m - 1 + h) + intercept;
    forecast.push({ date: next.toISOString().slice(0, 10), value: Math.round(v * 100) / 100 });
  }

  // MAPE on historical fit.
  let sse = 0, sst = 0;
  const yMean = series.reduce((a, b) => a + b, 0) / m;
  for (let i = 0; i < m; i++) {
    sse += (series[i] - trend[i]) ** 2;
    sst += (series[i] - yMean) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;

  const result: ModelResultCanvasObject = {
    type: "model_result",
    title: `Forecast — ${target} over ${horizon} periods`,
    modelType: "forecast",
    metrics: { horizon, points: m, r2: round(r2), slope: round(slope) },
    predictions: {
      columns: [
        { name: dateCol, dtype: "date" },
        { name: target, dtype: "number" },
        { name: "trend", dtype: "number" },
      ],
      rows: [
        ...dates.map((d, i) => ({ [dateCol]: d, [target]: series[i], trend: Math.round(trend[i] * 100) / 100 })),
        ...forecast.map((f) => ({ [dateCol]: f.date, [target]: null, trend: f.value })),
      ],
    },
    explanation: `Fit a linear trend to ${m} dated points (R² = ${round(r2).toFixed(2)}, slope ≈ ${round(slope).toFixed(2)}/period) and projected ${horizon} periods forward. Treat long-horizon projections as directional, not precise.`,
  };
  return { reply: result.explanation!, canvas: [result] };
}

function guessStepDays(dates: string[]): number {
  if (dates.length < 2) return 1;
  const a = new Date(dates[0]).getTime();
  const b = new Date(dates[1]).getTime();
  const days = Math.round((b - a) / 86400000);
  return days > 0 ? days : 1;
}

// ---------------------------------------------------------------------------
// Tiny linear-algebra helpers
// ---------------------------------------------------------------------------

function transpose<T>(m: T[][]): T[][] {
  return m[0].map((_, j) => m.map((r) => r[j]));
}
function matMul(a: number[][], b: number[][]): number[][] {
  return a.map((row) => transpose(b).map((col) => row.reduce((s, v, i) => s + v * col[i], 0)));
}
function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, v, i) => s + v * v[i], 0));
}
function dist(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}
function linreg(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}
function meanAbsError(y: number[], p: number[]): number {
  return y.reduce((s, v, i) => s + Math.abs(v - p[i]), 0) / y.length;
}

// Gaussian elimination for small systems (k+1 small).
function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-9) continue; // singular guard
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-9 ? 0 : row[n] / row[i]));
}

function inferType(v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "number") return "number";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
}
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
