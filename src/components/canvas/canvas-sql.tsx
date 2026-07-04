"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { Terminal, Check, AlertCircle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import type { SqlCanvasObject } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CanvasSql({ obj }: { obj: SqlCanvasObject }) {
  const [expanded, setExpanded] = useState(true);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const ok = obj.executed && !obj.error;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Terminal className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">SQL</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {ok ? (
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <Check className="h-3.5 w-3.5" />
              executed{obj.rowCount !== undefined ? ` · ${obj.rowCount} rows` : ""}
              {obj.durationMs !== undefined && (
                <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                  <Clock className="h-3 w-3" /> {obj.durationMs}ms
                </span>
              )}
            </span>
          ) : obj.error ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> failed
            </span>
          ) : (
            <span className="text-muted-foreground">not executed</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <SyntaxHighlighter
            language="sql"
            style={isDark ? oneDark : oneLight}
            customStyle={{
              margin: 0,
              background: "transparent",
              padding: "0.875rem 1rem",
              fontSize: "0.8125rem",
              lineHeight: 1.55,
            }}
            wrapLongLines
          >
            {obj.query}
          </SyntaxHighlighter>
          {obj.error && (
            <div className={cn("px-4 py-2 text-xs text-destructive border-t border-border/50 bg-destructive/5")}>
              {obj.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
