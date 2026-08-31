"use client";

import { ShieldCheck, AlertTriangle, AlertCircle, Info, Database, Activity } from "lucide-react";
import type { DataQualityCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The data-quality scan canvas card. Renders the scan's health score
 * prominently, then a list of issues coloured by severity. Designed to
 * be the first thing the user sees when they connect — like a
 * mechanic's report card before you take the car out.
 */
export function CanvasDataQuality({ obj }: { obj: DataQualityCanvasObject }) {
  const critical = obj.issues.filter((i) => i.severity === "critical");
  const notable = obj.issues.filter((i) => i.severity === "notable");
  const info = obj.issues.filter((i) => i.severity === "info");

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header with health score */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border",
        obj.healthScore >= 80 ? "bg-emerald-500/5" : obj.healthScore >= 50 ? "bg-amber-500/5" : "bg-destructive/5"
      )}>
        <div className={cn(
          "h-10 w-10 rounded-lg border flex items-center justify-center shrink-0",
          obj.healthScore >= 80
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            : obj.healthScore >= 50
            ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
            : "bg-destructive/10 border-destructive/30 text-destructive"
        )}>
          {obj.healthScore >= 80 ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{obj.title}</div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(obj.generatedAt).toLocaleString()} · {obj.issues.length} issue{obj.issues.length === 1 ? "" : "s"} found
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={cn(
            "text-2xl font-semibold tabular-nums leading-none",
            obj.healthScore >= 80
              ? "text-emerald-600 dark:text-emerald-400"
              : obj.healthScore >= 50
              ? "text-amber-600 dark:text-amber-400"
              : "text-destructive"
          )}>
            {obj.healthScore}
          </div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">health</div>
        </div>
      </div>

      {/* Summary chips */}
      {obj.issues.length > 0 ? (
        <div className="px-4 py-2 border-b border-border/60 flex flex-wrap gap-1.5 text-[10px]">
          {critical.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> {critical.length} critical
            </span>
          )}
          {notable.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5">
              <AlertCircle className="h-2.5 w-2.5" /> {notable.length} notable
            </span>
          )}
          {info.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5">
              <Info className="h-2.5 w-2.5" /> {info.length} info
            </span>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>No issues detected — your data looks clean.</span>
        </div>
      )}

      {/* Issues list */}
      {obj.issues.length > 0 && (
        <div className="divide-y divide-border/40">
          {obj.issues.map((issue, i) => (
            <div key={i} className={cn(
              "px-4 py-2.5",
              issue.severity === "critical" && "bg-destructive/[0.02]"
            )}>
              <div className="flex items-start gap-2">
                <span className={cn(
                  "mt-0.5 h-3.5 w-3.5 rounded-full flex items-center justify-center shrink-0",
                  issue.severity === "critical"
                    ? "bg-destructive/15 text-destructive"
                    : issue.severity === "notable"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                )}>
                  {issue.severity === "critical"
                    ? <AlertTriangle className="h-2 w-2" />
                    : issue.severity === "notable"
                    ? <AlertCircle className="h-2 w-2" />
                    : <Info className="h-2 w-2" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{issue.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{issue.description}</div>
                  <div className="text-[9px] text-muted-foreground/70 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="inline-flex items-center gap-0.5">
                      <Database className="h-2 w-2" /> <span className="font-mono">{issue.table}</span>{issue.column ? ` · ` : ""}
                      {issue.column && <span className="font-mono">{issue.column}</span>}
                    </span>
                    {issue.metric && issue.value !== undefined && (
                      <span className="inline-flex items-center gap-0.5">
                        <Activity className="h-2 w-2" /> {issue.metric} = <span className="font-medium text-foreground">{String(issue.value)}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
