/**
 * "What changed?" — period-over-period diff report.
 *
 * Triggered when the user clicks the "What changed?" button in the chat
 * header (or types a "what changed" / "compare periods" prompt).
 *
 * The agent:
 *   1. Finds the table with the most rows + a date column.
 *   2. Identifies the most recent complete period (month / week / day —
 *      picked by inspecting the gap between consecutive dates).
 *   3. Aggregates every numeric column for the recent period + the prior
 *      period of the same length.
 *   4. Computes the % change for each metric.
 *   5. Surfaces the biggest movers (positive + negative) as hidden patterns.
 *   6. Returns a structured report with focus="what_changed" so the canvas
 *      renders it under the "What changed" badge.
 */
import { completeJson } from "@/lib/llm";
import type {
  AgentState,
  CanvasObject,
  HiddenPattern,
  ReportCanvasObject,
  ReportKeyMetric,
  ReportSection,
} from "@/lib/types";
import type { DataFrame } from "@/lib/frame-cache";
import { getConnection, applyRowLimit } from "@/lib/db-connection";
import { storeFrame } from "@/lib/frame-cache";

export interface WhatChangedOutput {
  reply: string;
  canvas: CanvasObject[];
}

interface MetricDiff {
  column: string;
  recent: number;
  prior: number;
  changePct: number | null; // null if prior was 0 or both are 0
  direction: "up" | "down" | "flat";
}

interface DiffResult {
  tableName: string;
  dateColumn: string;
  periodLabel: string; // e.g. "2024-03 (last month)" and "2024-02 (prior month)"
  recentPeriodStart: string;
  recentPeriodEnd: string;
  priorPeriodStart: string;
  priorPeriodEnd: string;
  recentRowCount: number;
  priorRowCount: number;
  diffs: MetricDiff[];
}

const WHAT_CHANGED_PATTERN = /\b(what\s+changed|compare\s+(?:periods?|months?|quarters?|weeks?)|period[\s-]?over[\s-]?period|mom|qoq|wow|yoy|month[\s-]?over[\s-]?month)\b/i;

export function isWhatChangedPrompt(text: string): boolean {
  return WHAT_CHANGED_PATTERN.test(text);
}

export async function runWhatChangedReport(state: AgentState): Promise<WhatChangedOutput> {
  const snap = state.schemaSnapshot;
  if (!snap) {
    return {
      reply: "I need a connected database to compare periods. Connect to one first.",
      canvas: [],
    };
  }

  // ---- 1. Pick the table + date column to diff on -----------------------
  const target = pickDiffTable(snap);
  if (!target) {
    return {
      reply: "I couldn't find a table with a date column to compare periods on. Try uploading data with a date column (e.g. an `orders` table with `created_at`).",
      canvas: [],
    };
  }

  // ---- 2. Load a sample of the data -------------------------------------
  const frame = await loadSampleFrame(state, target.tableName, target.dateColumn, target.numericColumns);
  if (!frame || frame.rows.length < 10) {
    return {
      reply: `I loaded ${target.tableName} but it has too few rows (${frame?.rows.length ?? 0}) to compute a meaningful period-over-period diff.`,
      canvas: [],
    };
  }

  // ---- 3. Identify the most recent + prior period -----------------------
  const diff = computeDiff(frame, target.dateColumn, target.numericColumns);
  if (!diff) {
    return {
      reply: `I couldn't determine two comparable periods from ${target.dateColumn} in ${target.tableName}. Make sure the dates span at least two full periods.`,
      canvas: [],
    };
  }

  // ---- 4. Mine hidden patterns from the diffs ---------------------------
  const patterns: HiddenPattern[] = [];
  const sortedByAbsChange = [...diff.diffs].sort((a, b) => {
    const aAbs = a.changePct === null ? 0 : Math.abs(a.changePct);
    const bAbs = b.changePct === null ? 0 : Math.abs(b.changePct);
    return bAbs - aAbs;
  });

  // Top movers
  const topMovers = sortedByAbsChange.slice(0, 5);
  for (const m of topMovers) {
    if (m.changePct === null) continue;
    const absChange = Math.abs(m.changePct);
    if (absChange < 5) continue; // skip trivial changes

    const isCritical = absChange > 50;
    patterns.push({
      kind: "trend",
      title: `${m.column} ${m.direction === "up" ? "grew" : m.direction === "down" ? "dropped" : "stayed flat"} ${Math.abs(m.changePct).toFixed(0)}% period-over-period`,
      description: `${m.column} moved from ${fmtNum(m.prior)} in the prior period to ${fmtNum(m.recent)} in the most recent period — a ${m.direction === "up" ? "gain" : m.direction === "down" ? "drop" : "no change"} of ${Math.abs(m.changePct).toFixed(0)}%. ${absChange > 30 ? "This is a big enough move to investigate — check whether a campaign, product launch, or data issue coincides with the change." : "Worth keeping an eye on."}`,
      evidence: {
        metric: "period-over-period change",
        value: `${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}%`,
        baseline: `${fmtNum(m.prior)} → ${fmtNum(m.recent)}`,
      },
      columns: [m.column],
      severity: isCritical ? "critical" : absChange > 15 ? "notable" : "info",
    });
  }

  // Row count change pattern
  const rowChangePct = diff.priorRowCount > 0
    ? ((diff.recentRowCount - diff.priorRowCount) / diff.priorRowCount) * 100
    : null;
  if (rowChangePct !== null && Math.abs(rowChangePct) > 10) {
    patterns.push({
      kind: "trend",
      title: `Row count ${rowChangePct > 0 ? "grew" : "shrank"} ${Math.abs(rowChangePct).toFixed(0)}% period-over-period`,
      description: `The number of records in ${diff.tableName} went from ${diff.priorRowCount.toLocaleString()} in the prior period to ${diff.recentRowCount.toLocaleString()} in the most recent period — a ${rowChangePct > 0 ? "gain" : "drop"} of ${Math.abs(rowChangePct).toFixed(0)}%. ${Math.abs(rowChangePct) > 30 ? "This is unusual enough to warrant a closer look — either the data pipeline broke or something significant happened." : "Mostly normal variability."}`,
      evidence: {
        metric: "row count change",
        value: `${rowChangePct > 0 ? "+" : ""}${rowChangePct.toFixed(0)}%`,
        baseline: `${diff.priorRowCount.toLocaleString()} → ${diff.recentRowCount.toLocaleString()} rows`,
      },
      columns: [diff.dateColumn],
      severity: Math.abs(rowChangePct) > 50 ? "critical" : Math.abs(rowChangePct) > 25 ? "notable" : "info",
    });
  }

  // ---- 5. Build the report via the LLM narrator -------------------------
  const keyMetrics: ReportKeyMetric[] = topMovers.slice(0, 4).map((m) => ({
    label: m.column,
    value: fmtNum(m.recent),
    trend: m.direction,
    hint: `${m.changePct === null ? "no prior value" : `${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}% vs prior`}`,
  }));

  const sections: ReportSection[] = [
    {
      id: "executive_summary",
      title: "Executive Summary",
      bullets: topMovers.slice(0, 3).map((m) =>
        `- **${m.column}**: ${m.direction === "up" ? "↑" : m.direction === "down" ? "↓" : "→"} ${m.changePct === null ? "no prior value" : `${Math.abs(m.changePct).toFixed(0)}%`} (${fmtNum(m.prior)} → ${fmtNum(m.recent)})`
      ),
      body: await narrateExecutiveSummary(state, diff, patterns),
    },
    {
      id: "biggest_movers",
      title: "Biggest Movers",
      body: topMovers.length
        ? topMovers
            .map((m) => `- **${m.column}**: ${fmtNum(m.prior)} → ${fmtNum(m.recent)} (${m.changePct === null ? "no prior" : `${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}%`})`)
            .join("\n")
        : "No significant changes detected.",
    },
    {
      id: "methodology",
      title: "Methodology",
      body: `I compared two consecutive periods of equal length from the \`${diff.dateColumn}\` column in \`${diff.tableName}\`:\n\n- **Recent period**: ${diff.recentPeriodStart} → ${diff.recentPeriodEnd} (${diff.recentRowCount.toLocaleString()} rows)\n- **Prior period**: ${diff.priorPeriodStart} → ${diff.priorPeriodEnd} (${diff.priorRowCount.toLocaleString()} rows)\n\nFor each numeric column I summed the values within each period and computed the percent change. The biggest absolute movers are surfaced above. Note: this is a directional read, not a statistical test — short periods with low row counts can produce noisy percentages.`,
    },
  ];

  const recommendedQuestions = [
    `What drove the change in ${topMovers[0]?.column ?? "the top metric"}?`,
    `Break down the recent period by category.`,
    `Show me the daily breakdown of ${topMovers[0]?.column ?? "the top metric"} for the last 30 days.`,
    `Are there any outliers in ${diff.tableName} during the recent period?`,
  ].slice(0, 4);

  const report: ReportCanvasObject = {
    type: "report",
    title: "What Changed — Period-over-Period Diff",
    generatedAt: new Date().toISOString(),
    focus: "what_changed",
    depth: "standard",
    includeTechnicals: true,
    datasetSummary: {
      rows: frame.rowCount,
      columns: frame.columns.length,
      timespan: `${diff.priorPeriodStart} → ${diff.recentPeriodEnd}`,
      tableNames: [diff.tableName],
    },
    executiveSummary: sections[0].body,
    keyMetrics,
    sections,
    hiddenPatterns: patterns,
    recommendedQuestions,
  };

  const summary = patterns.length
    ? `Biggest change: ${patterns[0].title}.`
    : "No significant changes detected.";

  return {
    reply: `I compared ${diff.recentPeriodStart} to ${diff.priorPeriodStart} in \`${diff.tableName}\`. ${summary} Open the report on the right for the full breakdown.`,
    canvas: [report],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickDiffTable(snap: AgentState["schemaSnapshot"]): {
  tableName: string;
  dateColumn: string;
  numericColumns: string[];
} | null {
  if (!snap) return null;
  // Score each table by: has a date column? has 2+ numeric columns? row count?
  // A "date column" is detected by EITHER its dataType (date/time/timestamp)
  // OR its name (contains date/time/created/updated/day/month/year) — this
  // catches CSV-uploaded dates that get typed as "number" by SQLite.
  const scored = snap.tables.map((t) => {
    const dateCol = t.columns.find((c) =>
      /date|time|timestamp|created|updated/i.test(c.dataType)
      || /date|time|created|updated|day|month|year/i.test(c.name)
    );
    if (!dateCol) return null;
    // Numeric columns excluding the date column AND excluding ID columns
    // (order_id, customer_id, etc.) which are identifiers, not metrics —
    // their "growth" is meaningless even though they're typed as numbers.
    const tableNameSingular = t.name.split(/[_\s-]/)[0].toLowerCase().replace(/s$/i, "");
    const isIdColumn = (colName: string): boolean => {
      const c = colName.toLowerCase();
      return c === "id"
        || c === `${tableNameSingular}_id`
        || c === `${tableNameSingular}id`
        || /(_id$|^.*_id$)/.test(c);  // any column ending in "_id"
    };
    const numericCols = t.columns.filter((c) =>
      c.name !== dateCol.name
      && !isIdColumn(c.name)
      && /int|float|real|decimal|numeric|number|double/i.test(c.dataType)
    );
    if (numericCols.length === 0) return null;
    return {
      tableName: t.name,
      dateColumn: dateCol.name,
      numericColumns: numericCols.slice(0, 6).map((c) => c.name),
      score: Math.log10(Math.max(1, t.rowCount)) + numericCols.length,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

async function loadSampleFrame(state: AgentState, tableName: string, dateColumn: string, numericColumns: string[]): Promise<DataFrame | null> {
  const conn = state.sessionId ? getConnection(state.sessionId) : undefined;
  if (!conn) return null;

  // Pull a generous sample — we need to see the time range to pick periods.
  const cols = [dateColumn, ...numericColumns].map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
  const sql = `SELECT ${cols} FROM "${tableName.replace(/"/g, '""')}" ORDER BY "${dateColumn.replace(/"/g, '""')}" DESC LIMIT 2000;`;

  try {
    const guarded = applyRowLimit(sql, 2000);
    const result = await conn.query(guarded, 2000);
    const frame = storeFrame(result, guarded);
    return frame;
  } catch {
    return null;
  }
}

function computeDiff(frame: DataFrame, dateColumn: string, numericColumns: string[]): DiffResult | null {
  // Parse + sort all dates descending.
  const datedRows = frame.rows
    .map((r) => ({ row: r, ts: Date.parse(String(r[dateColumn])) }))
    .filter((d) => !Number.isNaN(d.ts))
    .sort((a, b) => b.ts - a.ts);
  if (datedRows.length < 4) return null;

  // Determine the natural period size by inspecting the gap between
  // consecutive timestamps.
  const periodMs = guessPeriodMs(datedRows.map((d) => d.ts));
  if (periodMs <= 0) return null;

  // Most recent timestamp = max.
  const mostRecent = datedRows[0].ts;
  // Recent period: (mostRecent - periodMs, mostRecent]
  const recentStart = mostRecent - periodMs;
  const priorStart = recentStart - periodMs;

  const recentRows = datedRows.filter((d) => d.ts > recentStart && d.ts <= mostRecent);
  const priorRows = datedRows.filter((d) => d.ts > priorStart && d.ts <= recentStart);

  if (recentRows.length < 2 || priorRows.length < 2) return null;

  const diffs: MetricDiff[] = numericColumns.map((col) => {
    const recent = recentRows.reduce((s, d) => s + (Number(d.row[col]) || 0), 0);
    const prior = priorRows.reduce((s, d) => s + (Number(d.row[col]) || 0), 0);
    let changePct: number | null = null;
    if (prior !== 0) changePct = ((recent - prior) / Math.abs(prior)) * 100;
    const direction: MetricDiff["direction"] =
      changePct === null ? "flat" :
      Math.abs(changePct) < 1 ? "flat" :
      changePct > 0 ? "up" : "down";
    return { column: col, recent, prior, changePct, direction };
  });

  return {
    tableName: frame.columns[0]?.name ?? "(unknown)",
    dateColumn,
    periodLabel: "period-over-period",
    recentPeriodStart: new Date(recentStart).toISOString().slice(0, 10),
    recentPeriodEnd: new Date(mostRecent).toISOString().slice(0, 10),
    priorPeriodStart: new Date(priorStart).toISOString().slice(0, 10),
    priorPeriodEnd: new Date(recentStart).toISOString().slice(0, 10),
    recentRowCount: recentRows.length,
    priorRowCount: priorRows.length,
    diffs,
  };
}

/** Guess the natural period (in ms) by inspecting the median gap between
 *  consecutive timestamps. Falls back to 30 days if can't tell. */
function guessPeriodMs(timestamps: number[]): number {
  if (timestamps.length < 2) return 30 * 86400_000;
  // Sort ascending for gap calculation.
  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 30 * 86400_000;
  // Median gap.
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  // Multiply by a reasonable number of periods (e.g. 30 days for daily data).
  if (median < 2 * 3600_000) return 24 * 3600_000; // < 2 hours → daily
  if (median < 7 * 86400_000) return 7 * 86400_000; // < 7 days → weekly
  return 30 * 86400_000; // monthly
}

function fmtNum(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(x / 1_000).toFixed(1)}k`;
  if (abs >= 1) return x.toFixed(abs < 10 ? 2 : 0);
  return x.toFixed(3);
}

async function narrateExecutiveSummary(
  state: AgentState,
  diff: DiffResult,
  patterns: HiddenPattern[]
): Promise<string> {
  const patternsDigest = patterns.length
    ? patterns.map((p) => `- ${p.title}: ${p.description}`).join("\n")
    : "(no significant changes detected)";
  const topMoversDigest = diff.diffs
    .slice()
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 5)
    .map((m) => `- ${m.column}: ${fmtNum(m.prior)} → ${fmtNum(m.recent)} (${m.changePct === null ? "no prior" : `${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}%`})`)
    .join("\n");

  try {
    const out = await completeJson<{ summary: string }>(
      [
        {
          role: "system",
          content: `You are the executive summary writer for a period-over-period diff report. Write 3-5 sentences a non-expert executive could read in 20 seconds. Lead with the single most important change. Use **bold** for the most important number. Plain English — no jargon. Return ONLY JSON: { "summary": "..." }`,
        },
        {
          role: "user",
          content: `User asked: "${state.userInput}"

Recent period: ${diff.recentPeriodStart} → ${diff.recentPeriodEnd} (${diff.recentRowCount.toLocaleString()} rows)
Prior period:  ${diff.priorPeriodStart} → ${diff.priorPeriodEnd} (${diff.priorRowCount.toLocaleString()} rows)
Table: ${diff.tableName}

Top movers:
${topMoversDigest}

Hidden patterns:
${patternsDigest}

Write the executive summary now. Return ONLY JSON.`,
        },
      ],
      { temperature: 0.4, maxTokens: 400 }
    );
    return out.summary || "See the biggest movers and hidden patterns below for a summary of what changed.";
  } catch {
    // Fallback — synthesize from the patterns directly.
    if (!patterns.length) return "No significant period-over-period changes were detected.";
    return patterns.slice(0, 3).map((p) => p.title).join(". ") + ".";
  }
}
