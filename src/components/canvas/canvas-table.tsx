"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Table as TableIcon, ChevronDown, ChevronRight } from "lucide-react";
import type { TableCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CanvasTable({ obj }: { obj: TableCanvasObject }) {
  const [expanded, setExpanded] = useState(true);
  const rows = obj.rows;
  const total = obj.totalRows ?? rows.length;

  const formatted = useMemo<ReactNode[][]>(
    () => rows.map((r) => obj.columns.map((c) => formatCell(r[c.name]))),
    [rows, obj.columns]
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <TableIcon className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{obj.title || "Query result"}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()} {total === 1 ? "row" : "rows"}
          {obj.truncated ? " · showing first 200" : ""}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border overflow-auto max-h-96">
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
                <tr key={i} className={cn("border-b border-border/50 last:border-0", i % 2 === 1 && "bg-muted/20")}>
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
