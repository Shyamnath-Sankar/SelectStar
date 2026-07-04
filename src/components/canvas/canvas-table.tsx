"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Table as TableIcon, ChevronDown, ChevronRight, Download, Copy, Check } from "lucide-react";
import type { TableCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function CanvasTable({ obj }: { obj: TableCanvasObject }) {
  const [expanded, setExpanded] = useState(true);
  const rows = obj.rows;
  const total = obj.totalRows ?? rows.length;

  const formatted = useMemo<ReactNode[][]>(
    () => rows.map((r) => obj.columns.map((c) => formatCell(r[c.name]))),
    [rows, obj.columns]
  );

  function exportCsv() {
    const csv = toCsv(obj.columns.map((c) => c.name), rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-result-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported CSV");
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/60 bg-muted/20">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 px-2 py-1 text-left hover:bg-accent/50 rounded-md transition-colors flex-1 min-w-0"
        >
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <TableIcon className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium text-sm truncate">{obj.title || "Query result"}</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
            {total.toLocaleString()} {total === 1 ? "row" : "rows"}
            {obj.truncated ? " · first 200" : ""}
          </span>
        </button>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          title="Export as CSV"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">CSV</span>
        </button>
      </div>
      {expanded && (
        <div className="overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
              <tr>
                {obj.columns.map((c) => (
                  <th key={c.name} className="text-left font-medium px-3 py-2 whitespace-nowrap border-b border-border">
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      {c.dtype && <span className="text-[10px] font-normal text-muted-foreground">{c.dtype}</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {formatted.map((row, i) => (
                <tr key={i} className={cn("border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors", i % 2 === 1 && "bg-muted/20")}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 whitespace-nowrap font-mono text-xs tabular-nums align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): ReactNode {
  if (v === null || v === undefined) return <span className="text-muted-foreground/60 italic">NULL</span>;
  if (typeof v === "object") {
    let s: string;
    try { s = JSON.stringify(v); } catch { s = String(v); }
    return s;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(v);
}

/** Convert rows to a CSV string with proper quoting. */
function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map(esc).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}
