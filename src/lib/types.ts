/**
 * Shared types for the agentic database-analysis platform.
 *
 * These types are intentionally framework-agnostic so they can be imported
 * from both server code (API routes, agents) and client code without pulling
 * in server-only dependencies.
 */

// ---------------------------------------------------------------------------
// Schema snapshot (result of the one-time introspection pass)
// ---------------------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string } | null;
}

export interface TableInfo {
  name: string;
  schema?: string;
  columns: ColumnInfo[];
  rowCount: number;
  // Short, LLM-friendly description if we can infer one.
  description?: string;
}

export interface SchemaSnapshot {
  dialect: Dialect;
  database?: string;
  tables: TableInfo[];
  introspectedAt: string; // ISO timestamp
}

export type Dialect = "sqlite" | "postgres" | "mysql" | "csv" | "xlsx";

/** Top-level mode: live SQL database, or Classic (CSV/XLSX) file analysis. */
export type AppMode = "sql" | "classic";

// ---------------------------------------------------------------------------
// Canvas objects — the discriminated union rendered in the canvas pane.
// Mirrors section 7 of the spec. Backend and frontend share this contract.
// ---------------------------------------------------------------------------

export interface TableCanvasObject {
  type: "table";
  title?: string;
  columns: { name: string; dtype?: string }[];
  rows: Record<string, unknown>[];
  // Total rows in the underlying query (rows[] may be truncated for display).
  totalRows?: number;
  truncated?: boolean;
}

export interface ChartCanvasObject {
  type: "chart";
  title?: string;
  // A Vega-Lite spec. Data is embedded inline so the spec is self-contained.
  spec: Record<string, unknown>;
  // Optional caption shown beneath the chart.
  caption?: string;
}

export interface SqlCanvasObject {
  type: "sql";
  query: string;
  executed: boolean;
  // Optional row count when executed.
  rowCount?: number;
  // Milliseconds to run, when executed.
  durationMs?: number;
  error?: string;
}

export interface EdaSummaryCanvasObject {
  type: "eda_summary";
  title?: string;
  // One entry per analysed column.
  columns: EdaColumnStats[];
  insights?: string[];
}

export interface EdaColumnStats {
  name: string;
  dtype: string;
  count: number;
  nulls: number;
  nullPct: number;
  unique: number;
  // Numeric-only fields (null otherwise)
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  // Top categorical values for non-numeric columns.
  topValues?: { value: string; count: number }[];
}

export interface ModelResultCanvasObject {
  type: "model_result";
  title?: string;
  modelType: string; // "linear_regression" | "kmeans" | "forecast" | ...
  metrics: Record<string, number>;
  // Small predictions / cluster-assignment table.
  predictions?: { columns: { name: string; dtype?: string }[]; rows: Record<string, unknown>[] };
  explanation?: string;
}

export interface PendingWriteCanvasObject {
  type: "pending_write";
  query: string;
  estimatedImpact: string;
  // A token the frontend sends back to confirm/rollback the write.
  pendingId: string;
  status?: "pending" | "confirmed" | "executed" | "rolled_back" | "failed";
  rowsAffected?: number;
  error?: string;
}

export interface ErrorCanvasObject {
  type: "error";
  title?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Report agent — a multi-section narrative report with hidden-pattern mining
// ---------------------------------------------------------------------------

/**
 * A single hidden pattern surfaced by the report agent's mining pass.
 * Designed to be the "aha!" moment for non-expert users — things they
 * would not have spotted without statistical tooling.
 */
export interface HiddenPattern {
  /** Machine-readable pattern kind. */
  kind:
    | "outlier"
    | "correlation"
    | "pareto"
    | "trend"
    | "skew"
    | "null_pattern"
    | "cluster"
    | "category_dominance"
    | "range_anomaly";
  /** One-line headline, e.g. "Top 5% of orders drive 62% of revenue". */
  title: string;
  /** 1-3 sentence plain-English explanation a non-expert can act on. */
  description: string;
  /** Structured evidence so the UI can render the number prominently. */
  evidence: {
    metric: string;
    value: string | number;
    /** Optional secondary metric for context (e.g. baseline). */
    baseline?: string | number;
  };
  /** Columns involved in this pattern. */
  columns: string[];
  /** "info" = interesting context, "notable" = worth acting on, "critical" = red flag. */
  severity: "info" | "notable" | "critical";
}

export interface ReportSection {
  id: string;
  title: string;
  /** Markdown body — may include bullet lists, bold, inline code. */
  body: string;
  /** Optional short bullet highlights shown above the body. */
  bullets?: string[];
}

export interface ReportKeyMetric {
  label: string;
  value: string;
  /** Optional trend indicator when the metric is time-comparable. */
  trend?: "up" | "down" | "flat";
  /** Optional secondary explanation under the value. */
  hint?: string;
}

/**
 * A structured, narrative report — the deliverable produced by the report
 * agent's generator phase. Rendered as a dedicated canvas card with
 * section navigation, hidden-pattern highlights, and a Markdown download.
 */
export interface ReportCanvasObject {
  type: "report";
  title: string;
  /** ISO timestamp the report was generated. */
  generatedAt: string;
  /** What the user picked in the planner phase, recorded for transparency. */
  focus: string;
  depth: "quick" | "standard" | "deep";
  datasetSummary: {
    rows: number;
    columns: number;
    timespan?: string;
    tableNames: string[];
  };
  executiveSummary: string;
  keyMetrics: ReportKeyMetric[];
  sections: ReportSection[];
  hiddenPatterns: HiddenPattern[];
  /** Suggested follow-up questions to nudge the user toward deeper analysis. */
  recommendedQuestions: string[];
}

/**
 * The interactive planner card — phase 1 of the report flow.
 *
 * Surfaces focus / depth / section options the user picks before the
 * generator runs. Selecting an option and clicking "Generate Report"
 * posts a structured chat message that the router recognises and routes
 * back into the report agent's generator phase.
 */
export interface ReportPlanOption {
  id: string;
  label: string;
  description: string;
  /** Mark the recommended default for this option group. */
  recommended?: boolean;
}

export interface ReportPlanCanvasObject {
  type: "report_plan";
  planId: string;
  title: string;
  /** Short context shown above the options — "I'll analyze ~3,200 orders across 6 tables…". */
  contextNote: string;
  focusOptions: ReportPlanOption[];
  depthOptions: ReportPlanOption[];
  sectionOptions: ReportPlanOption[];
  /** Pre-selected option ids, the UI uses these as defaults. */
  defaultFocus: string;
  defaultDepth: string;
  defaultSections: string[];
}

// ---------------------------------------------------------------------------
// Data-quality scan — emitted automatically on connect
// ---------------------------------------------------------------------------

export interface DataQualityIssue {
  /** Machine-readable kind. */
  kind:
    | "high_nulls"
    | "duplicate_keys"
    | "negative_values"
    | "future_dates"
    | "out_of_range"
    | "constant_column"
    | "mixed_types";
  severity: "info" | "notable" | "critical";
  /** Plain-English title of the issue. */
  title: string;
  /** 1-2 sentence explanation a non-expert can act on. */
  description: string;
  /** The affected table + column. */
  table: string;
  column?: string;
  /** Numeric evidence if available (e.g. null percentage, duplicate count). */
  metric?: string;
  value?: string | number;
}

export interface DataQualityCanvasObject {
  type: "data_quality";
  title: string;
  generatedAt: string;
  issues: DataQualityIssue[];
  /** Overall health score 0-100, derived from issue severities. */
  healthScore: number;
}

export type CanvasObject =
  | TableCanvasObject
  | ChartCanvasObject
  | SqlCanvasObject
  | EdaSummaryCanvasObject
  | ModelResultCanvasObject
  | PendingWriteCanvasObject
  | ReportPlanCanvasObject
  | ReportCanvasObject
  | DataQualityCanvasObject
  | ErrorCanvasObject;

// ---------------------------------------------------------------------------
// Agent shared state (flows through the orchestrator graph)
// ---------------------------------------------------------------------------

export type AgentName =
  | "router"
  | "schema"
  | "sql"
  | "eda"
  | "viz"
  | "ml"
  | "report"
  | "synthesis";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional canvas objects produced by this assistant turn (for history).
  artifacts?: CanvasObject[];
  /**
   * Inline HITL artifacts (pending_write, report_plan) that render inside the
   * chat bubble instead of on the canvas pane. Persisted in the message meta
   * so they survive a session reload.
   */
  inlineArtifacts?: CanvasObject[];
}

export interface AgentState {
  sessionId: string;
  dialect: Dialect;
  /** "sql" live DB or "classic" CSV/XLSX file. Drives agent prompts. */
  mode: AppMode;
  schemaSnapshot: SchemaSnapshot | null;
  zenMode: boolean;
  messages: AgentMessage[];
  // The user's latest question.
  userInput: string;
  // Which agents the router decided to run.
  routedAgents: AgentName[];
  // A reference id to the most recent query result, stored server-side.
  lastResultId?: string;
  // The canvas objects produced THIS turn (appended to DB + sent to client).
  canvasObjects: CanvasObject[];
  // Short human-readable status steps shown in the chat ("Running query…").
  steps: { agent: AgentName; label: string; ts: number }[];
  // Pending write awaiting user confirmation, if any.
  pendingWrite?: {
    pendingId: string;
    query: string;
    estimatedImpact: string;
  } | null;
  // Final chat reply text.
  reply?: string;
  // Error, if the turn failed.
  error?: string;
}

// ---------------------------------------------------------------------------
// SSE event stream — what the /api/chat route emits to the frontend.
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "step"; agent: AgentName; label: string }
  | { type: "sql"; query: string; executed: boolean; rowCount?: number; durationMs?: number; error?: string }
  | { type: "canvas"; object: CanvasObject }
  | { type: "token"; text: string }
  | { type: "follow_ups"; questions: string[] }
  | { type: "reply_done"; reply: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export interface ConnectRequest {
  connectionString: string;
  label?: string;
}

export interface ConnectResponse {
  sessionId: string;
  dialect: Dialect;
  schema: SchemaSnapshot;
  canWrite: boolean;
  suggestedQuestions: string[];
  /** Detected domain id (e.g. "sales") if a template matched the schema. */
  domain?: string;
  error?: string;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export interface ConfirmWriteRequest {
  pendingId: string;
  action: "confirm" | "rollback" | "cancel";
}
