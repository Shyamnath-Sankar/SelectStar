"use client";

import { useMemo, useRef, useState, Component, type ReactNode } from "react";
import { VegaEmbed } from "react-vega";
import type { ChartCanvasObject } from "@/lib/types";
import { BarChart3, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";

export function CanvasChart({ obj }: { obj: ChartCanvasObject }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // Inject theme-aware config so charts match the app's accent + dark mode.
  const spec = useMemo(() => withTheme(obj.spec), [obj.spec]);

  function exportSvg() {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) {
      toast.error("Chart not ready for export yet.");
      return;
    }
    setExporting(true);
    try {
      // Clone, set explicit width/height, add xmlns.
      const clone = svg.cloneNode(true) as SVGElement;
      const bbox = svg.getBoundingClientRect();
      clone.setAttribute("width", String(bbox.width));
      clone.setAttribute("height", String(bbox.height));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svgStr = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svgStr}`], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chart-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported SVG");
    } catch {
      toast.error("Couldn't export the chart.");
    } finally {
      setExporting(false);
    }
  }

  function exportPng() {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) {
      toast.error("Chart not ready for export yet.");
      return;
    }
    setExporting(true);
    try {
      const bbox = svg.getBoundingClientRect();
      const w = Math.max(bbox.width, 400);
      const h = Math.max(bbox.height, 300);
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = 2; // 2x for crisp output
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(url); setExporting(false); return; }
        ctx.fillStyle = document.documentElement.classList.contains("dark") ? "#1a1f24" : "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) { toast.error("Couldn't export PNG."); setExporting(false); return; }
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = `chart-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
          toast.success("Exported PNG");
          setExporting(false);
        }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast.error("Couldn't render the chart to PNG."); setExporting(false); };
      img.src = url;
    } catch {
      toast.error("Couldn't export the chart.");
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/20">
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <span className="font-medium text-sm truncate">{obj.title || "Chart"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={exportSvg}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-50"
            title="Export as SVG"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">SVG</span>
          </button>
          <button
            onClick={exportPng}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-50"
            title="Export as PNG"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">PNG</span>
          </button>
        </div>
      </div>
      <div ref={containerRef} className="px-4 py-3 [&_svg]:max-w-full overflow-x-auto">
        <ErrorBoundary fallback={<ChartError message="This chart spec couldn't be rendered." />}>
          <VegaEmbed
            spec={{ ...spec, $schema: spec.$schema || "https://vega.github.io/schema/vega-lite/v6.json" }}
            options={{ actions: false, renderer: "svg" }}
            className="w-full"
          />
        </ErrorBoundary>
      </div>
      {obj.caption && (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed">{obj.caption}</p>
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
