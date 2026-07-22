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

export type CanvasObject =
  | TableCanvasObject
  | ChartCanvasObject
  | SqlCanvasObject
  | EdaSummaryCanvasObject
  | ModelResultCanvasObject
  | PendingWriteCanvasObject
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
  | "synthesis";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional canvas objects produced by this assistant turn (for history).
  artifacts?: CanvasObject[];
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
