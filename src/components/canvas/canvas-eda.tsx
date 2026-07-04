"use client";

import { BarChart2, TrendingUp, TrendingDown } from "lucide-react";
import type { EdaSummaryCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CanvasEda({ obj }: { obj: EdaSummaryCanvasObject }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <BarChart2 className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{obj.title || "Statistical summary"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{obj.columns.length} columns</span>
      </div>

      <div className="overflow-auto max-h-96">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium border-b border-border">column</th>
              <th className="px-3 py-2 font-medium border-b border-border">type</th>
              <th className="px-3 py-2 font-medium border-b border-border text-right">nulls</th>
              <th className="px-3 py-2 font-medium border-b border-border text-right">unique</th>
              <th className="px-3 py-2 font-medium border-b border-border">min · median · max</th>
              <th className="px-3 py-2 font-medium border-b border-border">mean ± std</th>
              <th className="px-3 py-2 font-medium border-b border-border">top values</th>
            </tr>
          </thead>
          <tbody>
            {obj.columns.map((c) => {
              const nullPctClass = c.nullPct > 20 ? "text-destructive" : c.nullPct > 5 ? "text-amber-500" : "text-muted-foreground";
              return (
                <tr key={c.name} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-mono font-medium align-top">{c.name}</td>
                  <td className="px-3 py-2 text-muted-foreground align-top">{c.dtype}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums align-top", nullPctClass)}>
                    {c.nullPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums align-top">{c.unique.toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono tabular-nums align-top">
                    {c.mean !== null && c.mean !== undefined
                      ? `${fmt(c.min)} · ${fmt(c.median)} · ${fmt(c.max)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums align-top">
                    {c.mean !== null && c.mean !== undefined ? `${fmt(c.mean)} ± ${fmt(c.std)}` : "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {c.topValues && c.topValues.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.topValues.slice(0, 3).map((v) => (
                          <span key={v.value} className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px]">
                            <span className="font-mono max-w-[8rem] truncate">{v.value}</span>
                            <span className="text-muted-foreground">×{v.count}</span>
                          </span>
                        ))}
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {obj.insights && obj.insights.length > 0 && (
        <div className="border-t border-border px-4 py-3 space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Notable correlations
          </div>
          {obj.insights.map((ins, i) => (
            <div key={i} className="text-xs flex items-start gap-1.5">
              {/negative/.test(ins) ? (
                <TrendingDown className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              ) : (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
              )}
              <span>{ins.replace(/^- /, "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString();
  return Math.round(x * 1000) / 1000 + "";
}
