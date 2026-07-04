"use client";

import { useMemo, Component, type ReactNode } from "react";
import { VegaEmbed } from "react-vega";
import type { ChartCanvasObject } from "@/lib/types";
import { BarChart3, AlertTriangle } from "lucide-react";

export function CanvasChart({ obj }: { obj: ChartCanvasObject }) {
  // Inject theme-aware config so charts match the app's accent + dark mode.
  const spec = useMemo(() => withTheme(obj.spec), [obj.spec]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{obj.title || "Chart"}</span>
      </div>
      <div className="[&_svg]:max-w-full overflow-x-auto">
        <ErrorBoundary fallback={<ChartError message="This chart spec couldn't be rendered." />}>
          <VegaEmbed
            spec={{ ...spec, $schema: spec.$schema || "https://vega.github.io/schema/vega-lite/v6.json" }}
            options={{ actions: false, renderer: "svg" }}
            className="w-full"
          />
        </ErrorBoundary>
      </div>
      {obj.caption && (
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{obj.caption}</p>
      )}
    </div>
  );
}

/** Merge theme config (background, font, colors) into a Vega-Lite spec. */
function withTheme(spec: Record<string, unknown>): Record<string, unknown> {
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const config = {
    background: "transparent",
    font: "var(--font-geist-sans)",
    view: { stroke: "transparent" },
    axis: {
      domainColor: isDark ? "#ffffff20" : "#00000018",
      tickColor: isDark ? "#ffffff20" : "#00000018",
      labelColor: isDark ? "#a0a0a0" : "#555555",
      titleColor: isDark ? "#d0d0d0" : "#333333",
      gridColor: isDark ? "#ffffff0d" : "#0000000a",
      labelFontSize: 11,
      titleFontSize: 12,
    },
    legend: {
      labelColor: isDark ? "#c0c0c0" : "#444444",
      titleColor: isDark ? "#d0d0d0" : "#333333",
    },
    title: {
      color: isDark ? "#e0e0e0" : "#222222",
      fontSize: 13,
    },
  };
  return { ...spec, config: { ...config, ...(spec.config as object | undefined) } };
}

class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    /* swallow — the fallback renders */
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function ChartError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
      <AlertTriangle className="h-4 w-4" />
      {message}
    </div>
  );
}
