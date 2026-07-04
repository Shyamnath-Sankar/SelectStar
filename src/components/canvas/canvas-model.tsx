"use client";

import { useMemo, type ReactNode } from "react";
import { Cpu, Beaker, GitBranch, LineChart } from "lucide-react";
import type { ModelResultCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CanvasModel({ obj }: { obj: ModelResultCanvasObject }) {
  const Icon = obj.modelType === "kmeans" ? GitBranch : obj.modelType === "forecast" ? LineChart : Beaker;

  const formatted = useMemo<ReactNode[][]>(
    () => (obj.predictions?.rows || []).map((r) => (obj.predictions?.columns || []).map((c) => formatCell(r[c.name]))),
    [obj.predictions]
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{obj.title || "Model result"}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-accent rounded px-1.5 py-0.5">
          <Cpu className="h-3 w-3" /> {obj.modelType.replace("_", " ")}
        </span>
      </div>

      <div className="px-4 py-3 border-b border-border/50">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(obj.metrics).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
              <div className="text-sm font-mono tabular-nums">{fmt(v)}</div>
            </div>
          ))}
        </div>
      </div>

      {obj.predictions && obj.predictions.rows.length > 0 && (
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
              <tr>
                {obj.predictions.columns.map((c) => (
                  <th key={c.name} className="text-left font-medium px-3 py-2 whitespace-nowrap border-b border-border">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {formatted.map((row, i) => (
                <tr key={i} className={cn("border-b border-border/50 last:border-0", i % 2 === 1 && "bg-muted/20")}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {obj.explanation && (
        <p className="px-4 py-3 text-xs text-muted-foreground leading-relaxed">{obj.explanation}</p>
      )}
    </div>
  );
}

function formatCell(v: unknown): ReactNode {
  if (v === null || v === undefined) return <span className="text-muted-foreground/60 italic">—</span>;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  return String(v);
}

function fmt(x: number): string {
  if (Number.isNaN(x)) return "—";
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString();
  return (Math.round(x * 1000) / 1000).toString();
}
