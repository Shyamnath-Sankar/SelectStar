/**
 * Report agent — the "deeper analysis" specialist.
 *
 * Why this agent exists
 * --------------------
 * The other agents (EDA, Viz, ML, Synthesis) each answer a single focused
 * question: "what are the stats?", "chart this", "fit a model". The report
 * agent's job is the *narrative, end-to-end* deliverable: an executive
 * summary plus a hidden-pattern mining pass that surfaces things a
 * non-expert user would not have thought to ask about.
 *
 * Two-phase, human-in-the-loop
 * ----------------------------
 * Phase 1 — `runReportPlanner`: looks at the schema + the user's question,
 * emits an interactive `report_plan` canvas card with focus / depth /
 * sections options. No data is queried yet — the user has to confirm
 * what they actually want.
 *
 * Phase 2 — `runReportGenerator`: triggered when the orchestrator detects
 * a `__GENERATE_REPORT__ {...}` message from the chat client. Runs a
 * sample SQL query on the most relevant table, mines hidden patterns
 * (outliers, Pareto concentration, top correlations, trends, skew, null
 * patterns, dominant categories, mini k-means clusters), asks the LLM to
 * narrate the findings in plain English, and emits a structured `report`
 * canvas object.
 *
 * Hidden-pattern detection is pure TypeScript (no scikit-learn, no Python).
 * Each pattern is wrapped with a plain-English explanation so the user
 * gets the "aha!" without having to interpret a number.
 */
import { complete, completeJson } from "@/lib/llm";
import type {
  AgentState,
  CanvasObject,
  HiddenPattern,
  ReportCanvasObject,
  ReportPlanCanvasObject,
  ReportPlanOption,
  ReportSection,
} from "@/lib/types";
import type { DataFrame } from "@/lib/frame-cache";
import { getFrame } from "@/lib/frame-cache";
import { getConnection, applyRowLimit } from "@/lib/db-connection";
import { storeFrame } from "@/lib/frame-cache";
import { renderRelevantSchema } from "./schema-utils";
import { GENERATE_REPORT_PREFIX, isGenerateReportMessage } from "./report-constants";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportPlanOutput {
  reply: string;
  canvas: CanvasObject[];
}

export interface ReportGeneratorOutput {
  reply: string;
  canvas: CanvasObject[];
}

/** Shape the chat client sends back when the user clicks "Generate Report". */
export interface ReportGeneratorRequest {
  focus: string;
  depth: "quick" | "standard" | "deep";
  sections: string[];
  /**
   * When false (default), the report must be written in plain English with NO
   * technical terms — no "correlation", "Pearson r", "skew", "IQR", "k-means",
   * "outlier", "regression", "p-value", "R²", etc. Patterns are described
   * using everyday language ("moves together", "extreme values", "lopsided",
   * "natural groupings"). When true, the report may use the proper terms.
   */
  includeTechnicals: boolean;
}

// Re-export the prefix + detector so callers can import from either place.
export { GENERATE_REPORT_PREFIX, isGenerateReportMessage };

export function parseGenerateReportMessage(text: string): ReportGeneratorRequest | null {
  try {
    const json = text.trim().slice(GENERATE_REPORT_PREFIX.length).trim();
    const parsed = JSON.parse(json) as Partial<ReportGeneratorRequest>;
    if (!parsed.focus || !parsed.depth || !Array.isArray(parsed.sections)) return null;
    // Default `includeTechnicals` to false — the report is plain English
    // unless the user explicitly opted in to technical terms.
    return {
      focus: parsed.focus,
      depth: parsed.depth,
      sections: parsed.sections,
      includeTechnicals: parsed.includeTechnicals === true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — the planner
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are the report planner for an agentic data-analysis assistant.
Your job is to look at the user's question and the database schema, then propose a short menu
of report configurations the user can pick from. You do NOT write the report — only the plan.

Return ONLY a JSON object with this shape:
{
  "title": "short report title (e.g. 'Sales Performance Report')",
  "contextNote": "1 sentence describing what data will be analyzed",
  "focusOptions": [ { "id": "overall", "label": "Overall health", "description": "...", "recommended": true }, ... ],
  "depthOptions": [ { "id": "quick", "label": "Quick scan", "description": "...", "recommended": true }, ... ],
  "sectionOptions": [ { "id": "executive_summary", "label": "Executive summary", "description": "...", "recommended": true }, ... ]
}

Rules:
- Provide 3-5 focus options. Always include an "overall" option as recommended.
- Provide exactly 3 depth options: quick (1-2 min, surface findings), standard (recommended, 3-5 sections), deep (everything + modeling).
- Provide 5-8 section options. Always include: executive_summary, hidden_patterns, key_metrics, recommendations. Add domain-specific sections based on the schema (e.g. "trends" if date columns exist, "segments" if categorical columns exist, "data_quality" if there might be nulls).
- Mark exactly one focus, one depth as recommended.
- For sections, mark the 4 mandatory ones plus 1-2 contextually relevant ones as recommended.
- The user is a NON-EXPERT — use plain language in descriptions. Avoid jargon like "regression", "p-value", "k-means" in the labels.
- Keep descriptions to 8-15 words.`;

export async function runReportPlanner(state: AgentState): Promise<ReportPlanOutput> {
  const snap = state.schemaSnapshot;
  if (!snap || !snap.tables.length) {
    return {
      reply: "I can't plan a report without a schema. Connect to a database or upload a CSV first.",
      canvas: [],
    };
  }

  const schemaText = renderRelevantSchema(snap, state.userInput, 10);
  const history = state.messages
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const userPrompt = `Database dialect: ${snap.dialect}
Mode: ${state.mode}

Schema (most relevant tables):
${schemaText}

Recent conversation:
${history || "(none)"}

User's latest message:
"""${state.userInput}"""

Propose a report plan. Return ONLY JSON.`;

  let plan: {
    title: string;
    contextNote: string;
    focusOptions: ReportPlanOption[];
    depthOptions: ReportPlanOption[];
    sectionOptions: ReportPlanOption[];
  };

  try {
    plan = await completeJson<{
      title: string;
      contextNote: string;
      focusOptions: ReportPlanOption[];
      depthOptions: ReportPlanOption[];
      sectionOptions: ReportPlanOption[];
    }>(
      [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.2 }
    );
  } catch (e) {
    // Graceful fallback: build a sensible default plan from the schema.
    plan = fallbackPlan(snap, state.userInput);
  }

  // Sanitise + ensure required option ids exist.
  const focusOptions = sanitiseOptions(plan.focusOptions, FALLBACK_FOCUSES, "overall");
  const depthOptions = sanitiseOptions(plan.depthOptions, FALLBACK_DEPTHS, "standard");
  const sectionOptions = sanitiseOptions(plan.sectionOptions, FALLBACK_SECTIONS, "executive_summary");

  const defaultFocus = focusOptions.find((o) => o.recommended)?.id ?? focusOptions[0].id;
  const defaultDepth = depthOptions.find((o) => o.recommended)?.id ?? "standard";
  const defaultSections = sectionOptions.filter((o) => o.recommended).map((o) => o.id);
  if (!defaultSections.length) defaultSections.push("executive_summary", "hidden_patterns");

  const planId = `plan_${Date.now().toString(36)}`;
  const obj: ReportPlanCanvasObject = {
    type: "report_plan",
    planId,
    title: plan.title || "Data Report",
    contextNote: plan.contextNote || `I'll analyze the ${snap.tables.length} table${snap.tables.length === 1 ? "" : "s"} in your dataset and surface patterns you might have missed.`,
    focusOptions,
    depthOptions,
    sectionOptions,
    defaultFocus,
    defaultDepth,
    defaultSections,
    // Default OFF — the user must explicitly opt in to technical terms. The
    // generated report is plain English by default.
    defaultIncludeTechnicals: false,
  };

  return {
    reply: `I've drafted a plan for **${obj.title}**. Pick a focus, a depth, and the sections you want — then click "Generate Report" and I'll dig in.`,
    canvas: [obj],
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — the generator
// ---------------------------------------------------------------------------

export async function runReportGenerator(
  state: AgentState,
  request: ReportGeneratorRequest
): Promise<ReportGeneratorOutput> {
  const snap = state.schemaSnapshot;
  if (!snap) {
    return {
      reply: "I can't generate a report without a connected schema.",
      canvas: [],
    };
  }

  // ---- 1. Acquire a dataframe to analyze -----------------------------
  // Use the last SELECT result if available, otherwise run a sample query
  // against the most relevant table.
  let frame: DataFrame | undefined = state.lastResultId ? getFrame(state.lastResultId) : undefined;

  if (!frame) {
    const sample = await runSampleQuery(state, request);
    if (!sample) {
      return {
        reply: "I couldn't load any data to analyze. Try asking a question that retrieves some rows first, then re-run the report.",
        canvas: [],
      };
    }
    frame = sample;
  }

  if (!frame.rows.length) {
    return {
      reply: "The dataset has zero rows — there's nothing for me to analyze yet.",
      canvas: [],
    };
  }

  // ---- 2. Profile + mine hidden patterns ------------------------------
  const profile = profileFrame(frame);
  const patterns = mineHiddenPatterns(frame, profile, request.depth, request.includeTechnicals);

  // ---- 3. Optional: enrich with a quick model (deep mode only) -------
  let modelNarrative = "";
  if (request.depth === "deep") {
    modelNarrative = await runOptionalModel(state, frame);
  }

  // ---- 4. Ask the LLM to narrate the report ---------------------------
  const requestedSections = new Set(request.sections);
  const report = await narrateReport({
    state,
    request,
    frame,
    profile,
    patterns,
    modelNarrative,
    requestedSections,
  });

  const obj: ReportCanvasObject = {
    type: "report",
    title: report.title,
    generatedAt: new Date().toISOString(),
    focus: request.focus,
    depth: request.depth,
    includeTechnicals: request.includeTechnicals,
    datasetSummary: {
      rows: frame.rowCount,
      columns: frame.columns.length,
      timespan: profile.timespan,
      tableNames: snap.tables.slice(0, 5).map((t) => t.name),
    },
    executiveSummary: report.executiveSummary,
    keyMetrics: report.keyMetrics,
    sections: report.sections,
    hiddenPatterns: patterns,
    recommendedQuestions: report.recommendedQuestions,
  };

  return {
    reply: `**${report.title}** is ready. I surfaced ${patterns.length} hidden pattern${patterns.length === 1 ? "" : "s"} — the most notable ${patterns.find((p) => p.severity === "critical") ? "is flagged as critical" : "is worth acting on"}. Scroll through the report on the right, or download it as Markdown.`,
    canvas: [obj],
  };
}

// ---------------------------------------------------------------------------
// Helpers — sanitise options
// ---------------------------------------------------------------------------

const FALLBACK_FOCUSES: ReportPlanOption[] = [
  { id: "overall", label: "Overall health", description: "A balanced look across every important column.", recommended: true },
  { id: "growth", label: "Growth & trends", description: "Focus on how metrics change over time." },
  { id: "segments", label: "Customer segments", description: "Group rows by category and compare them." },
  { id: "anomalies", label: "Anomalies & outliers", description: "Hunt for rows that look unusual." },
];

const FALLBACK_DEPTHS: ReportPlanOption[] = [
  { id: "quick", label: "Quick scan", description: "1-2 min — surface findings only." },
  { id: "standard", label: "Standard", description: "3-5 sections with full narrative.", recommended: true },
  { id: "deep", label: "Deep dive", description: "Everything + a quick model fit." },
];

const FALLBACK_SECTIONS: ReportPlanOption[] = [
  { id: "executive_summary", label: "Executive summary", description: "3-5 sentence overview.", recommended: true },
  { id: "key_metrics", label: "Key metrics", description: "The numbers that matter most.", recommended: true },
  { id: "hidden_patterns", label: "Hidden patterns", description: "What the data quietly tells you.", recommended: true },
  { id: "recommendations", label: "Recommendations", description: "Suggested next steps.", recommended: true },
  { id: "trends", label: "Trends over time", description: "How metrics move over time." },
  { id: "segments", label: "Segment breakdown", description: "Group-by comparisons." },
  { id: "data_quality", label: "Data quality", description: "Nulls, duplicates, anomalies." },
  { id: "methodology", label: "Methodology", description: "How the analysis was done." },
];

function sanitiseOptions(
  provided: ReportPlanOption[],
  fallback: ReportPlanOption[],
  requiredId: string
): ReportPlanOption[] {
  if (!Array.isArray(provided) || provided.length === 0) return fallback;
  // Ensure the required id is present.
  const ids = new Set(provided.map((o) => o.id));
  const cleaned = provided.filter((o) => o.id && o.label && o.description);
  if (!ids.has(requiredId)) {
    const fb = fallback.find((o) => o.id === requiredId);
    if (fb) cleaned.unshift(fb);
  }
  // Ensure exactly one recommended option.
  const recs = cleaned.filter((o) => o.recommended);
  if (recs.length === 0) {
    const idx = cleaned.findIndex((o) => o.id === requiredId);
    if (idx >= 0) cleaned[idx].recommended = true;
  } else if (recs.length > 1) {
    let seen = false;
    for (const o of cleaned) {
      if (o.recommended) {
        if (seen) o.recommended = false;
        seen = true;
      }
    }
  }
  return cleaned;
}

function fallbackPlan(snap: { tables: { name: string; rowCount: number; columns: { name: string; dataType: string }[] }[] }, question: string) {
  const mainTable = snap.tables[0];
  return {
    title: `${mainTable ? mainTable.name : "Data"} Report`,
    contextNote: `I'll analyze the ${snap.tables.length} table${snap.tables.length === 1 ? "" : "s"} in your dataset and surface patterns you might have missed.`,
    focusOptions: FALLBACK_FOCUSES,
    depthOptions: FALLBACK_DEPTHS,
    sectionOptions: FALLBACK_SECTIONS,
  };
}

// ---------------------------------------------------------------------------
// Sample-query helper — runs a SELECT against the most relevant table
// ---------------------------------------------------------------------------

async function runSampleQuery(state: AgentState, request: ReportGeneratorRequest): Promise<DataFrame | undefined> {
  const snap = state.schemaSnapshot;
  const conn = state.sessionId ? getConnection(state.sessionId) : undefined;
  if (!snap || !conn) return undefined;

  // Pick the most relevant table for the focus area.
  const table = pickTableForFocus(snap, request.focus, state.userInput);
  if (!table) return undefined;

  // Build a sample SELECT. Use the first 1000 rows of the most relevant table.
  // In classic mode the table name is whatever the user uploaded.
  const cols = table.columns.map((c) => c.name).slice(0, 20); // cap columns for safety
  const colList = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
  const sql = `SELECT ${colList} FROM "${table.name.replace(/"/g, '""')}" LIMIT 1000;`;

  try {
    const guarded = applyRowLimit(sql, 1000);
    const result = await conn.query(guarded, 1000);
    const frame = storeFrame(result, guarded);
    return frame;
  } catch {
    return undefined;
  }
}

function pickTableForFocus(
  snap: { tables: { name: string; rowCount: number; columns: { name: string; dataType: string }[] }[] },
  focus: string,
  question: string
): { name: string; columns: { name: string; dataType: string }[] } | undefined {
  if (!snap.tables.length) return undefined;

  // Single-table (classic mode): just use it.
  if (snap.tables.length === 1) return snap.tables[0];

  // Score tables by focus + question keywords.
  const q = (question + " " + focus).toLowerCase();
  const scored = snap.tables.map((t) => {
    let score = Math.log10(Math.max(1, t.rowCount));
    const nameToks = t.name.toLowerCase().split(/[_\s]/);
    for (const tok of nameToks) if (tok.length > 2 && q.includes(tok)) score += 5;
    // Tables with date + numeric columns are good for trends focus.
    const hasDate = t.columns.some((c) => /date|time|timestamp/i.test(c.dataType));
    const hasNumeric = t.columns.some((c) => /int|float|real|decimal|numeric|number/i.test(c.dataType));
    if (focus === "growth" && hasDate && hasNumeric) score += 3;
    if (focus === "anomalies" && hasNumeric) score += 2;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].t;
}

// ---------------------------------------------------------------------------
// Frame profiling — pure TS statistics, mirrors a slimmed-down EDA pass
// ---------------------------------------------------------------------------

interface ColumnProfile {
  name: string;
  dtype: string;
  count: number;
  nulls: number;
  nullPct: number;
  unique: number;
  isNumeric: boolean;
  isDate: boolean;
  isCategorical: boolean;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  std?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  skew?: number;
  topValues?: { value: string; count: number; pct: number }[];
}

interface FrameProfile {
  rowCount: number;
  colCount: number;
  numericColumns: ColumnProfile[];
  categoricalColumns: ColumnProfile[];
  dateColumns: ColumnProfile[];
  allColumns: ColumnProfile[];
  timespan?: string;
  /** Top Pearson correlations between numeric column pairs (|r| > 0.4). */
  topCorrelations: { a: string; b: string; r: number }[];
}

function profileFrame(frame: DataFrame): FrameProfile {
  const cols: ColumnProfile[] = frame.columns.map((c) =>
    profileColumn(c.name, c.dtype || inferType(frame.rows[0]?.[c.name]), frame.rows.map((r) => r[c.name]))
  );

  const numericColumns = cols.filter((c) => c.isNumeric);
  const categoricalColumns = cols.filter((c) => c.isCategorical);
  const dateColumns = cols.filter((c) => c.isDate);

  // Top correlations
  const topCorrelations: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const a = frame.rows.map((r) => Number(r[numericColumns[i].name]));
      const b = frame.rows.map((r) => Number(r[numericColumns[j].name]));
      const r = pearson(a, b);
      if (Math.abs(r) > 0.4) topCorrelations.push({ a: numericColumns[i].name, b: numericColumns[j].name, r });
    }
  }
  topCorrelations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  // Timespan across all date columns
  let timespan: string | undefined;
  if (dateColumns.length) {
    const allDates: number[] = [];
    for (const c of dateColumns) {
      for (const row of frame.rows) {
        const v = row[c.name];
        if (v === null || v === undefined) continue;
        const t = Date.parse(String(v));
        if (!Number.isNaN(t)) allDates.push(t);
      }
    }
    if (allDates.length) {
      const min = Math.min(...allDates);
      const max = Math.max(...allDates);
      timespan = `${new Date(min).toISOString().slice(0, 10)} → ${new Date(max).toISOString().slice(0, 10)}`;
    }
  }

  return {
    rowCount: frame.rowCount,
    colCount: frame.columns.length,
    numericColumns,
    categoricalColumns,
    dateColumns,
    allColumns: cols,
    timespan,
    topCorrelations,
  };
}

function profileColumn(name: string, dtype: string, values: unknown[]): ColumnProfile {
  const count = values.length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  const nulls = count - nonNull.length;
  const nullPct = count ? (nulls / count) * 100 : 0;
  const uniqueSet = new Set(nonNull.map((v) => String(v)));
  const unique = uniqueSet.size;

  const nums = nonNull.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  const isNumeric = nums.length >= nonNull.length * 0.8 && nums.length > 0;
  const isDate = !isNumeric && nonNull.some((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(v)));
  const isCategorical = !isNumeric && !isDate;

  const base: ColumnProfile = {
    name,
    dtype,
    count,
    nulls,
    nullPct,
    unique,
    isNumeric,
    isDate,
    isCategorical,
  };

  if (isNumeric && nums.length) {
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const std = Math.sqrt(variance);
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    const median = percentile(sorted, 0.5);
    const iqr = q3 - q1;
    // Skewness (Fisher-Pearson)
    const skew = std > 0 ? nums.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) / nums.length : 0;
    return { ...base, min: sorted[0], max: sorted[sorted.length - 1], mean, median, std, q1, q3, iqr, skew };
  }

  if (isCategorical) {
    const freq = new Map<string, number>();
    for (const v of nonNull) {
      const key = String(v);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, c]) => ({ value, count: c, pct: (c / count) * 100 }));
    return { ...base, topValues };
  }

  return base;
}

function inferType(v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
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

// ---------------------------------------------------------------------------
// Hidden-pattern mining — the heart of the report agent
// ---------------------------------------------------------------------------

function mineHiddenPatterns(
  frame: DataFrame,
  profile: FrameProfile,
  depth: "quick" | "standard" | "deep",
  includeTechnicals: boolean,
): HiddenPattern[] {
  const patterns: HiddenPattern[] = [];

  // Outliers via IQR — flag any numeric column with > 3% outliers
  for (const col of profile.numericColumns) {
    if (col.iqr === undefined || col.q1 === undefined || col.q3 === undefined) continue;
    const lower = col.q1 - 1.5 * col.iqr;
    const upper = col.q3 + 1.5 * col.iqr;
    const rows = frame.rows.map((r) => Number(r[col.name])).filter((n) => !Number.isNaN(n));
    const outliers = rows.filter((n) => n < lower || n > upper);
    const pct = (outliers.length / rows.length) * 100;
    if (pct >= 3) {
      patterns.push({
        kind: "outlier",
        title: includeTechnicals
          ? `${pct.toFixed(1)}% of "${col.name}" values are statistical outliers`
          : `${pct.toFixed(0)}% of "${col.name}" values are far outside the typical range`,
        description: includeTechnicals
          ? `About ${Math.round(outliers.length)} of ${rows.length.toLocaleString()} rows fall outside the typical range (${fmtNum(lower)} to ${fmtNum(upper)}). This usually means either data entry errors or genuinely extreme cases worth investigating.`
          : `About ${Math.round(outliers.length)} of ${rows.length.toLocaleString()} rows are much higher or lower than the rest. Usually that means either a data-entry mistake or a genuinely extreme case worth a closer look.`,
        evidence: { metric: "outlier percentage", value: `${pct.toFixed(1)}%`, baseline: `${outliers.length} rows` },
        columns: [col.name],
        severity: pct > 10 ? "critical" : "notable",
      });
    }
  }

  // Pareto / category dominance — top category share of a numeric total
  for (const cat of profile.categoricalColumns.slice(0, 6)) {
    if (!cat.topValues?.length) continue;
    if (cat.unique < 3 || cat.unique > 50) continue;
    // Need a numeric column to compute totals against.
    const numCol = profile.numericColumns[0];
    if (!numCol) continue;
    const totalsByCat = new Map<string, number>();
    let grand = 0;
    for (const row of frame.rows) {
      const k = String(row[cat.name] ?? "(null)");
      const v = Number(row[numCol.name]);
      if (Number.isNaN(v)) continue;
      totalsByCat.set(k, (totalsByCat.get(k) ?? 0) + v);
      grand += v;
    }
    if (!grand) continue;
    const ranked = [...totalsByCat.entries()].sort((a, b) => b[1] - a[1]);
    const topShare = (ranked[0][1] / grand) * 100;
    const topNShare = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2))).reduce((s, [, v]) => s + v, 0) / grand * 100;
    if (topNShare >= 70 && ranked.length >= 3) {
      patterns.push({
        kind: "pareto",
        title: `Top ${Math.ceil(ranked.length * 0.2)} ${cat.name}${Math.ceil(ranked.length * 0.2) === 1 ? "" : "s"} drive ${topNShare.toFixed(0)}% of ${numCol.name}`,
        description: `The classic 80/20 pattern: a small number of ${cat.name} values account for the bulk of ${numCol.name}. ${ranked[0][0]} alone contributes ${topShare.toFixed(0)}% of the total. Concentrating effort on these top performers is likely the highest-leverage move available.`,
        evidence: { metric: "concentration", value: `${topNShare.toFixed(0)}%`, baseline: `${ranked.length} ${cat.name} values total` },
        columns: [cat.name, numCol.name],
        severity: topNShare >= 90 ? "critical" : "notable",
      });
    }
  }

  // Top correlations
  for (const corr of profile.topCorrelations.slice(0, 3)) {
    const direction = corr.r > 0 ? "positively" : "negatively";
    const strength = Math.abs(corr.r) > 0.8 ? "strongly " : "";
    patterns.push({
      kind: "correlation",
      title: includeTechnicals
        ? `${corr.a} and ${corr.b} are ${strength}${direction} correlated (r=${corr.r.toFixed(2)})`
        : `${corr.a} and ${corr.b} ${strength}${corr.r > 0 ? "rise" : "move in opposite directions"} together`,
      description: includeTechnicals
        ? `When ${corr.a} goes ${corr.r > 0 ? "up" : "down"}, ${corr.b} tends to go ${corr.r > 0 ? "up" : "down"} too. The relationship is ${Math.abs(corr.r) > 0.8 ? "strong enough" : "moderate enough"} that one can roughly predict the other. Useful for forecasting, but remember correlation isn't causation — there may be a hidden driver.`
        : `When ${corr.a} goes ${corr.r > 0 ? "up" : "down"}, ${corr.b} tends to go ${corr.r > 0 ? "up" : "down"} too. The link is ${Math.abs(corr.r) > 0.8 ? "strong enough" : "moderate enough"} that knowing one roughly tells you the other. Useful for planning, but the link alone doesn't prove one causes the other — something else may be driving both.`,
      evidence: includeTechnicals
        ? { metric: "Pearson r", value: corr.r.toFixed(2) }
        : { metric: "strength of link", value: Math.abs(corr.r) > 0.8 ? "strong" : "moderate" },
      columns: [corr.a, corr.b],
      severity: Math.abs(corr.r) > 0.85 ? "notable" : "info",
    });
  }

  // Trends over time — find date columns paired with a numeric, compute slope
  for (const dateCol of profile.dateColumns) {
    for (const numCol of profile.numericColumns.slice(0, 4)) {
      // Aggregate by date
      const byDate = new Map<string, number>();
      for (const row of frame.rows) {
        const d = String(row[dateCol.name]);
        if (!d) continue;
        const v = Number(row[numCol.name]);
        if (Number.isNaN(v)) continue;
        byDate.set(d, (byDate.get(d) ?? 0) + v);
      }
      const dates = [...byDate.keys()].sort();
      const series = dates.map((d) => byDate.get(d)!);
      if (series.length < 5) continue;
      const xs = series.map((_, i) => i);
      const { slope, intercept, r2 } = linreg(xs, series);
      if (r2 < 0.3) continue;
      const startVal = intercept;
      const endVal = slope * (series.length - 1) + intercept;
      const pctChange = startVal !== 0 ? ((endVal - startVal) / Math.abs(startVal)) * 100 : 0;
      if (Math.abs(pctChange) < 15) continue;
      patterns.push({
        kind: "trend",
        title: `${numCol.name} ${pctChange > 0 ? "grew" : "declined"} ${Math.abs(pctChange).toFixed(0)}% over ${dates.length} periods`,
        description: includeTechnicals
          ? `Across ${dates.length} time points (from ${dates[0]} to ${dates[dates.length - 1]}), ${numCol.name} moved from roughly ${fmtNum(startVal)} to ${fmtNum(endVal)}. The linear fit explains ${(r2 * 100).toFixed(0)}% of the variance — ${r2 > 0.7 ? "a strong, consistent trend" : "a real but noisy trend"}.`
          : `Across ${dates.length} time points (from ${dates[0]} to ${dates[dates.length - 1]}), ${numCol.name} moved from roughly ${fmtNum(startVal)} to ${fmtNum(endVal)}. ${r2 > 0.7 ? "The trend is strong and steady" : "The trend is real but a bit bumpy"}.`,
        evidence: includeTechnicals
          ? { metric: "percent change", value: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}%`, baseline: `R²=${r2.toFixed(2)}` }
          : { metric: "percent change", value: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}%` },
        columns: [dateCol.name, numCol.name],
        severity: Math.abs(pctChange) > 50 ? "critical" : "notable",
      });
    }
  }

  // Skew — flag highly skewed numeric distributions
  for (const col of profile.numericColumns) {
    if (col.skew === undefined) continue;
    if (Math.abs(col.skew) > 1.5) {
      patterns.push({
        kind: "skew",
        title: includeTechnicals
          ? `"${col.name}" is ${col.skew > 0 ? "right" : "left"}-skewed (skew=${col.skew.toFixed(2)})`
          : `"${col.name}" is lopsided toward ${col.skew > 0 ? "a few very large values" : "a few very small values"}`,
        description: includeTechnicals
          ? `The distribution is ${col.skew > 0 ? "pulled to the right by a few very large values" : "pulled to the left by a few very small values"}. The mean (${fmtNum(col.mean)}) is ${col.skew > 0 ? "higher" : "lower"} than the median (${fmtNum(col.median)}). For typical reporting use the median; reserve the mean for symmetric data.`
          : `Most rows cluster around ${fmtNum(col.median)}, but a ${col.skew > 0 ? "few unusually high" : "few unusually low"} values drag the average (${fmtNum(col.mean)}) ${col.skew > 0 ? "upward" : "downward"}. For everyday reporting, the median (${fmtNum(col.median)}) is the more representative number.`,
        evidence: includeTechnicals
          ? { metric: "skewness", value: col.skew.toFixed(2), baseline: `mean ${fmtNum(col.mean)} vs median ${fmtNum(col.median)}` }
          : { metric: "typical value", value: fmtNum(col.median), baseline: `average ${fmtNum(col.mean)}` },
        columns: [col.name],
        severity: "info",
      });
    }
  }

  // Null patterns — flag columns with > 5% missing
  for (const col of profile.allColumns) {
    if (col.nullPct < 5) continue;
    patterns.push({
      kind: "null_pattern",
      title: `"${col.name}" is missing ${col.nullPct.toFixed(1)}% of its values`,
      description: `About ${col.nulls.toLocaleString()} of ${col.count.toLocaleString()} rows have no value for ${col.name}. ${col.nullPct > 30 ? "This is high enough that any analysis using this column should treat the missing rows as a separate group, not ignore them." : "Most analyses will tolerate this, but the missing rows are worth understanding before drawing conclusions."}`,
      evidence: { metric: "missing rate", value: `${col.nullPct.toFixed(1)}%`, baseline: `${col.nulls.toLocaleString()} rows` },
      columns: [col.name],
      severity: col.nullPct > 30 ? "critical" : "notable",
    });
  }

  // Range anomaly — flag numeric columns where max/min ratio is huge
  for (const col of profile.numericColumns) {
    if (col.min === undefined || col.max === undefined || col.median === undefined) continue;
    if (col.min <= 0 || col.max <= 0) continue;
    const ratio = col.max / col.min;
    if (ratio > 100 && col.median > 0) {
      const medianToMax = col.max / col.median;
      if (medianToMax > 10) {
        patterns.push({
          kind: "range_anomaly",
          title: includeTechnicals
            ? `"${col.name}" spans ${fmtNum(col.min)} to ${fmtNum(col.max)} — a ${Math.round(ratio).toLocaleString()}× range`
            : `"${col.name}" has values from ${fmtNum(col.min)} up to ${fmtNum(col.max)} — an unusually wide spread`,
          description: `The maximum value is ${medianToMax.toFixed(0)}× the median (${fmtNum(col.median)}). Either a small number of records are extreme outliers, or this column has mixed units/scales. Worth a spot-check before aggregating.`,
          evidence: { metric: "max/median ratio", value: `${medianToMax.toFixed(0)}×`, baseline: `range ${fmtNum(col.min)}–${fmtNum(col.max)}` },
          columns: [col.name],
          severity: "info",
        });
      }
    }
  }

  // Mini-clustering — if 2+ numeric columns, surface cluster structure
  if (depth !== "quick" && profile.numericColumns.length >= 2) {
    const clusters = miniKmeans(frame, profile.numericColumns.slice(0, 3).map((c) => c.name), 3);
    if (clusters) {
      const sizes = clusters.sizes.sort((a, b) => b - a);
      const dominant = (sizes[0] / clusters.total) * 100;
      patterns.push({
        kind: "cluster",
        title: includeTechnicals
          ? `The data splits into ${clusters.k} natural groups (sizes: ${sizes.join(", ")})`
          : `The data splits into ${clusters.k} natural groups`,
        description: includeTechnicals
          ? `A quick clustering on ${clusters.features.join(", ")} found ${clusters.k} groups. The largest group holds ${dominant.toFixed(0)}% of the rows — ${dominant > 70 ? "this suggests a dominant 'typical' profile with smaller specialty segments alongside" : "the segments are fairly balanced"}. Treating these groups separately in any further analysis will reveal more than treating the dataset as one population.`
          : `Looking at ${clusters.features.join(", ")} together, the rows fall into ${clusters.k} natural groups. The largest group holds ${dominant.toFixed(0)}% of the rows — ${dominant > 70 ? "this points to a dominant 'typical' profile, with smaller specialty groups alongside" : "the groups are fairly balanced in size"}. Treating these groups separately will reveal more than looking at the dataset as one big pile.`,
        evidence: { metric: "dominant cluster share", value: `${dominant.toFixed(0)}%`, baseline: `${clusters.k} groups` },
        columns: clusters.features,
        severity: "info",
      });
    }
  }

  // Sort by severity: critical first, then notable, then info.
  const order = { critical: 0, notable: 1, info: 2 };
  patterns.sort((a, b) => order[a.severity] - order[b.severity]);

  // Cap the count based on depth.
  const cap = depth === "quick" ? 5 : depth === "standard" ? 10 : 15;
  return patterns.slice(0, cap);
}

function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const predictions = xs.map((x) => slope * x + intercept);
  const ssRes = ys.reduce((s, y, i) => s + (y - predictions[i]) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function miniKmeans(
  frame: DataFrame,
  features: string[],
  k: number
): { k: number; features: string[]; sizes: number[]; total: number } | null {
  if (features.length < 2 || frame.rows.length < k * 3) return null;
  const raw = frame.rows.map((r) => features.map((f) => Number(r[f])));
  if (raw.some((row) => row.some((v) => Number.isNaN(v)))) return null;

  // Standardise.
  const n = raw.length;
  const dim = features.length;
  const means = features.map((_, j) => raw.reduce((s, r) => s + r[j], 0) / n);
  const stds = features.map((_, j) => Math.sqrt(raw.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n) || 1);
  const X = raw.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));

  // K-means++ init.
  const centroids: number[][] = [X[Math.floor(Math.random() * n)].slice()];
  while (centroids.length < k) {
    const dists = X.map((x) => Math.min(...centroids.map((c) => dist(x, c))) ** 2);
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    const r = Math.random() * total;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += dists[i];
      if (acc >= r) { centroids.push(X[i].slice()); break; }
    }
  }
  if (centroids.length < k) return null;

  const assignments = new Array(n).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(X[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
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

  const sizes = Array.from({ length: k }, (_, c) => assignments.filter((a) => a === c).length);
  return { k, features, sizes, total: n };
}

function dist(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function fmtNum(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(x / 1_000).toFixed(1)}k`;
  if (abs >= 1) return x.toFixed(abs < 10 ? 2 : 0);
  return x.toFixed(3);
}

// ---------------------------------------------------------------------------
// Optional model enrichment (deep mode)
// ---------------------------------------------------------------------------

async function runOptionalModel(state: AgentState, frame: DataFrame): Promise<string> {
  // Try a quick k-means if there are 2+ numeric columns.
  const numericCols = frame.columns
    .filter((c) => frame.rows.some((r) => !Number.isNaN(Number(r[c.name]))))
    .slice(0, 3);
  if (numericCols.length < 2 || frame.rows.length < 9) return "";

  try {
    const clusters = miniKmeans(frame, numericCols.map((c) => c.name), 3);
    if (!clusters) return "";
    const sizes = clusters.sizes.sort((a, b) => b - a);
    return `A quick clustering on ${clusters.features.join(", ")} found ${clusters.k} natural groups of sizes ${sizes.join(", ")}. The largest segment holds ${((sizes[0] / clusters.total) * 100).toFixed(0)}% of the rows.`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// LLM narration — turn numbers + patterns into a structured report
// ---------------------------------------------------------------------------

interface NarratedReport {
  title: string;
  executiveSummary: string;
  keyMetrics: { label: string; value: string; trend?: "up" | "down" | "flat"; hint?: string }[];
  sections: ReportSection[];
  recommendedQuestions: string[];
}

const NARRATOR_SYSTEM = `You are the report narrator for an agentic data-analysis assistant. A statistical engine has already mined the data and produced structured findings. Your job is to turn those numbers into a clear, structured report a NON-EXPERT can act on.

Style rules:
- Write in plain English. No jargon like "p-value", "kurtosis", "heteroscedasticity". If you must mention a metric, explain it in one short clause.
- Lead every section with the conclusion, then back it up.
- Use **bold** for the single most important number in each section.
- Keep sentences short. Vary sentence length for readability.
- Never invent numbers — use only what the engine provided. If something is missing, say "no clear pattern" instead of making one up.
- For the executive summary, write 3-5 sentences that a busy executive could read in 20 seconds.
- For recommendations, give 3-5 concrete next steps the user could take.

Output format — return ONLY this JSON shape:
{
  "title": "Report title",
  "executiveSummary": "3-5 sentence paragraph",
  "keyMetrics": [ { "label": "Total revenue", "value": "$1.2M", "trend": "up", "hint": "vs $1.0M last period" } ],
  "sections": [ { "id": "executive_summary", "title": "Executive Summary", "body": "Markdown paragraph(s)", "bullets": ["- short bullet", "- short bullet"] } ],
  "recommendedQuestions": [ "What drove the spike in March?", "Who are the top 10 customers?" ]
}

The "sections" array MUST include one entry per section id the user requested. If a section has no relevant findings, write a 2-sentence note saying so.`;

/** Variant of the narrator system prompt for "plain English only" mode —
 *  the user opted OUT of technical terms. The LLM must avoid statistical
 *  jargon entirely and use everyday language. */
const NARRATOR_SYSTEM_PLAIN = `You are the report narrator for an agentic data-analysis assistant. A statistical engine has already mined the data and produced structured findings. Your job is to turn those numbers into a clear, structured report a NON-EXPERT can act on.

CRITICAL STYLE RULE — plain English only:
- Do NOT use statistical or technical terms. The reader has no data background.
- BANNED words: "correlation", "Pearson", "r-value", "regression", "p-value", "skew", "skewed", "kurtosis", "outlier", "IQR", "quartile", "variance", "standard deviation", "k-means", "cluster", "clustering", "heteroscedasticity", "R²", "statistical", "significance", "normal distribution", "statistically significant".
- Use everyday equivalents instead:
  - "correlated" → "move together" / "tend to rise together" / "tend to move in opposite directions"
  - "outlier" → "unusual value" / "extreme value" / "value far outside the typical range"
  - "skewed" → "lopsided" / "pulled by a few extreme values"
  - "cluster" → "natural group" / "natural segment"
  - "regression" / "linear fit" → "trend line" / "the overall direction"
  - "variance" / "standard deviation" → "spread" / "how spread out the values are"
  - "statistically significant" → "real, not just noise"
- Lead every section with the conclusion, then back it up.
- Use **bold** for the single most important number in each section.
- Keep sentences short. Vary sentence length for readability.
- Never invent numbers — use only what the engine provided. If something is missing, say "no clear pattern" instead of making one up.
- For the executive summary, write 3-5 sentences that a busy executive could read in 20 seconds.
- For recommendations, give 3-5 concrete next steps the user could take.

Output format — return ONLY this JSON shape:
{
  "title": "Report title",
  "executiveSummary": "3-5 sentence paragraph",
  "keyMetrics": [ { "label": "Total revenue", "value": "$1.2M", "trend": "up", "hint": "vs $1.0M last period" } ],
  "sections": [ { "id": "executive_summary", "title": "Executive Summary", "body": "Markdown paragraph(s)", "bullets": ["- short bullet", "- short bullet"] } ],
  "recommendedQuestions": [ "What drove the spike in March?", "Who are the top 10 customers?" ]
}

The "sections" array MUST include one entry per section id the user requested. If a section has no relevant findings, write a 2-sentence note saying so.`;

async function narrateReport(args: {
  state: AgentState;
  request: ReportGeneratorRequest;
  frame: DataFrame;
  profile: FrameProfile;
  patterns: HiddenPattern[];
  modelNarrative: string;
  requestedSections: Set<string>;
}): Promise<NarratedReport> {
  const { state, request, frame, profile, patterns, modelNarrative, requestedSections } = args;

  // Compact textual digest of the data + patterns.
  // In plain-English mode (includeTechnicals === false), the digest avoids
  // technical metric names so the LLM doesn't get tempted to use them.
  const includeTechnicals = request.includeTechnicals;
  const columnDigest = profile.allColumns
    .slice(0, 15)
    .map((c) => {
      const parts: string[] = [`${c.name} (${c.dtype})`];
      parts.push(`missing ${c.nullPct.toFixed(1)}%`);
      parts.push(`${c.unique} unique values`);
      if (c.isNumeric) {
        if (includeTechnicals) {
          parts.push(`min ${fmtNum(c.min)} / mean ${fmtNum(c.mean)} / median ${fmtNum(c.median)} / max ${fmtNum(c.max)} (std ${fmtNum(c.std)}, skew ${c.skew?.toFixed(2)})`);
        } else {
          parts.push(`smallest ${fmtNum(c.min)} / typical ${fmtNum(c.median)} / largest ${fmtNum(c.max)} / average ${fmtNum(c.mean)}`);
        }
      } else if (c.topValues?.length) {
        parts.push(`most common: ${c.topValues.slice(0, 3).map((v) => `${v.value} (${v.count} rows)`).join(", ")}`);
      }
      return `- ${parts.join(", ")}`;
    })
    .join("\n");

  const patternsDigest = patterns.length
    ? patterns.map((p, i) => `[${i + 1}] (${p.severity}) ${p.title}\n    ${p.description}\n    evidence: ${p.evidence.metric}=${p.evidence.value}${p.evidence.baseline ? ` (baseline: ${p.evidence.baseline})` : ""}`).join("\n")
    : "(no hidden patterns were detected by the mining pass)";

  // In plain-English mode, suppress the "Strong correlations" section — it
  // uses r-values, which are technical. The patterns digest already has
  // plain-English versions of any strong relationships.
  const correlationsDigest = includeTechnicals
    ? (profile.topCorrelations.length
        ? profile.topCorrelations.slice(0, 5).map((c) => `${c.a} ↔ ${c.b}: r=${c.r.toFixed(2)}`).join("\n")
        : "(no strong correlations detected)")
    : "(suppressed — see patterns digest for plain-English relationships)";

  const sectionList = [...requestedSections].join(", ");

  const userPrompt = `User's original question: """${state.userInput}"""

Focus area chosen: ${request.focus}
Depth chosen: ${request.depth}
Sections requested: ${sectionList}
${includeTechnicals ? "" : "\nSTYLE: PLAIN ENGLISH ONLY. Do not use any statistical or technical terms (no 'correlation', 'Pearson r', 'skew', 'outlier', 'regression', 'cluster', 'R²', 'p-value', etc.). Use everyday words the reader already knows."}

Dataset summary:
- ${frame.rowCount.toLocaleString()} rows × ${frame.columns.length} columns${profile.timespan ? `\n- timespan: ${profile.timespan}` : ""}

Column statistics:
${columnDigest}

Strong correlations:
${correlationsDigest}

Hidden patterns mined by the engine (use ALL of these in the report):
${patternsDigest}

${modelNarrative ? `Quick model enrichment: ${modelNarrative}` : ""}

Write the full structured report now. Return ONLY JSON.`;

  try {
    const out = await completeJson<NarratedReport>(
      [
        { role: "system", content: includeTechnicals ? NARRATOR_SYSTEM : NARRATOR_SYSTEM_PLAIN },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.4, maxTokens: 2400 }
    );
    // Ensure the requested sections are present; backfill if missing.
    const have = new Set((out.sections || []).map((s) => s.id));
    const sections = [...(out.sections || [])];
    for (const id of requestedSections) {
      if (!have.has(id)) {
        sections.push({
          id,
          title: titleCase(id),
          body: "No specific findings for this section — the dataset did not surface a clear pattern here.",
        });
      }
    }
    return {
      title: out.title || "Data Report",
      executiveSummary: out.executiveSummary || "",
      keyMetrics: Array.isArray(out.keyMetrics) ? out.keyMetrics : [],
      sections,
      recommendedQuestions: Array.isArray(out.recommendedQuestions) ? out.recommendedQuestions.slice(0, 5) : [],
    };
  } catch (e) {
    // Fallback: assemble a minimal report from the patterns directly.
    return {
      title: "Data Report",
      executiveSummary: `I analyzed ${frame.rowCount.toLocaleString()} rows and surfaced ${patterns.length} hidden pattern${patterns.length === 1 ? "" : "s"}. ${patterns[0]?.title ?? "No critical issues were found."}`,
      keyMetrics: profile.numericColumns.slice(0, 4).map((c) => ({
        label: c.name,
        value: fmtNum(c.mean ?? 0),
        hint: `range ${fmtNum(c.min)}–${fmtNum(c.max)}`,
      })),
      sections: [...requestedSections].map((id) => ({
        id,
        title: titleCase(id),
        body: patterns
          .filter((p) => sectionPatternMatch(id, p))
          .map((p) => `- **${p.title}** — ${p.description}`)
          .join("\n") || "No specific findings for this section.",
      })),
      recommendedQuestions: [
        "What drove the most extreme outliers?",
        "Which segments grew the fastest?",
        "Where should we focus next?",
      ],
    };
  }
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sectionPatternMatch(sectionId: string, p: HiddenPattern): boolean {
  if (sectionId === "hidden_patterns") return true;
  if (sectionId === "data_quality") return p.kind === "null_pattern" || p.kind === "outlier" || p.kind === "range_anomaly";
  if (sectionId === "trends") return p.kind === "trend";
  if (sectionId === "segments") return p.kind === "cluster" || p.kind === "category_dominance" || p.kind === "pareto";
  if (sectionId === "anomalies") return p.kind === "outlier" || p.kind === "range_anomaly";
  return false;
}
