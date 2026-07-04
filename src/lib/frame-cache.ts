/**
 * In-memory cache for query results / "dataframes".
 *
 * Per spec §5: store dataframes server-side keyed by an id, and only pass the
 * id + a small preview through LLM context — never serialize a large dataframe
 * into a prompt. Agents retrieve the full frame by id when they need it.
 */
import type { QueryResult } from "@/lib/db-connection";

export interface DataFrame {
  id: string;
  columns: { name: string; dtype?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** The SQL that produced this frame, if any. */
  sourceSql?: string;
  createdAt: number;
}

const frames = new Map<string, DataFrame>();
// Cap the cache so a long session can't leak unbounded memory.
const MAX_FRAMES = 40;

let counter = 0;
export function newFrameId(): string {
  counter += 1;
  return `df_${Date.now().toString(36)}_${counter}`;
}

export function storeFrame(result: QueryResult, sourceSql?: string): DataFrame {
  const id = newFrameId();
  const frame: DataFrame = {
    id,
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    sourceSql,
    createdAt: Date.now(),
  };
  if (frames.size >= MAX_FRAMES) {
    // Evict the oldest entry.
    const oldest = frames.keys().next().value;
    if (oldest) frames.delete(oldest);
  }
  frames.set(id, frame);
  return frame;
}

export function getFrame(id: string): DataFrame | undefined {
  return frames.get(id);
}

/** A compact text preview of a frame, safe to embed in an LLM prompt. */
export function framePreview(frame: DataFrame, maxRows = 8): string {
  const cols = frame.columns.map((c) => c.name).join(" | ");
  const head = frame.rows.slice(0, maxRows).map((r) =>
    frame.columns.map((c) => formatCell(r[c.name])).join(" | ")
  );
  return [
    `Columns: ${cols}`,
    `Total rows: ${frame.rowCount}`,
    `Preview (first ${Math.min(maxRows, frame.rows.length)} rows):`,
    ...head,
    frame.rows.length > maxRows ? "... (truncated)" : "",
  ].join("\n");
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
