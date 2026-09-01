"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  FileText,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  Activity,
  Database,
  Sparkles,
  FileType,
  Presentation,
  Lock,
} from "lucide-react";
import type { ReportCanvasObject, HiddenPattern } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSession } from "@/lib/store";
import { streamChat } from "@/lib/chat-client";

/**
 * The full rendered report — the deliverable produced by the report agent's
 * generator phase. Rendered as a structured document card with:
 *  - Title + generated-at timestamp
 *  - Dataset summary chips (rows / cols / timespan / tables)
 *  - Key metrics row (with trend icons)
 *  - Hidden-pattern callouts (severity-coloured, expandable)
 *  - Section navigation + per-section rendered Markdown body
 *  - Recommended follow-up questions (clickable to send back to chat)
 *  - "Download as Markdown" + "Copy" actions
 */
export function CanvasReport({ obj }: { obj: ReportCanvasObject }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(obj.sections.map((s) => s.id))
  );
  const [expandedPatterns, setExpandedPatterns] = useState<Set<number>>(() => {
    // Expand the first critical/notable pattern by default.
    const initial = new Set<number>();
    const first = obj.hiddenPatterns.findIndex((p) => p.severity !== "info");
    if (first >= 0) initial.add(first);
    return initial;
  });
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(() => reportToMarkdown(obj), [obj]);
  const generatedDate = new Date(obj.generatedAt);

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePattern(idx: number) {
    setExpandedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = obj.title.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
    a.download = `${safeName || "report"}-${generatedDate.toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded as Markdown");
  }

  function copyMarkdown() {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Report copied to clipboard");
    });
  }

  const criticalCount = obj.hiddenPatterns.filter((p) => p.severity === "critical").length;
  const notableCount = obj.hiddenPatterns.filter((p) => p.severity === "notable").length;
  const infoCount = obj.hiddenPatterns.filter((p) => p.severity === "info").length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{obj.title}</div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>Generated {generatedDate.toLocaleString()} · {obj.depth} depth · focus: {obj.focus}</span>
            <span className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] uppercase tracking-wide",
              obj.includeTechnicals
                ? "bg-primary/10 text-primary"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}>
              {obj.includeTechnicals ? "technical" : "plain English"}
            </span>
          </div>
        </div>
        <button
          onClick={copyMarkdown}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          title="Copy report as Markdown"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          onClick={downloadMarkdown}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          title="Download as Markdown"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">.md</span>
        </button>
        {/* PDF export — coming soon. Disabled with a tooltip so users know
            this is on the roadmap, not just missing. */}
        <button
          disabled
          onClick={() => toast.info("PDF export is coming soon — for now, use the Markdown download and convert with any markdown-to-PDF tool.")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/50 cursor-not-allowed"
          title="PDF export — coming soon"
        >
          <Lock className="h-3 w-3" />
          <FileType className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">PDF</span>
          <span className="text-[8px] uppercase tracking-wide">soon</span>
        </button>
        {/* PPTX export — coming soon. */}
        <button
          disabled
          onClick={() => toast.info("PowerPoint export is coming soon — for now, use the Markdown download and paste into your slides.")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/50 cursor-not-allowed"
          title="PowerPoint export — coming soon"
        >
          <Lock className="h-3 w-3" />
          <Presentation className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">PPTX</span>
          <span className="text-[8px] uppercase tracking-wide">soon</span>
        </button>
      </div>

      {/* Dataset summary chips */}
      <div className="px-4 py-2.5 border-b border-border/60 bg-muted/20 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="inline-flex items-center gap-1 rounded-md bg-background border border-border px-1.5 py-0.5">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="tabular-nums">{obj.datasetSummary.rows.toLocaleString()}</span> rows
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-background border border-border px-1.5 py-0.5">
          <span className="tabular-nums">{obj.datasetSummary.columns}</span> cols
        </span>
        {obj.datasetSummary.timespan && (
          <span className="inline-flex items-center gap-1 rounded-md bg-background border border-border px-1.5 py-0.5">
            <Activity className="h-3 w-3 text-muted-foreground" />
            <span className="truncate max-w-[280px]">{obj.datasetSummary.timespan}</span>
          </span>
        )}
        {obj.datasetSummary.tableNames.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-background border border-border px-1.5 py-0.5 max-w-[300px]">
            <span className="text-muted-foreground">tables:</span>
            <span className="truncate font-mono">{obj.datasetSummary.tableNames.join(", ")}</span>
          </span>
        )}
      </div>

      {/* Key metrics row */}
      {obj.keyMetrics.length > 0 && (
        <div className="px-4 py-3 border-b border-border/60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {obj.keyMetrics.map((m, i) => (
            <div key={i} className="rounded-lg border border-border bg-background px-2.5 py-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{m.label}</div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-base font-semibold tabular-nums">{m.value}</span>
                {m.trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                {m.trend === "down" && <TrendingDown className="h-3 w-3 text-amber-500" />}
                {m.trend === "flat" && <Activity className="h-3 w-3 text-muted-foreground" />}
              </div>
              {m.hint && <div className="text-[10px] text-muted-foreground truncate mt-0.5">{m.hint}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Executive summary */}
      {obj.executiveSummary && (
        <div className="px-4 py-3 border-b border-border/60">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            Executive Summary
          </div>
          <div className="prose-chat text-xs leading-relaxed">
            <ReactMarkdown>{obj.executiveSummary}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Hidden patterns callouts */}
      {obj.hiddenPatterns.length > 0 && (
        <div className="px-4 py-3 border-b border-border/60">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Lightbulb className="h-3 w-3 text-primary" />
              Hidden Patterns
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" /> {criticalCount} critical
                </span>
              )}
              {notableCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5">
                  {notableCount} notable
                </span>
              )}
              {infoCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5">
                  {infoCount} info
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {obj.hiddenPatterns.map((p, i) => (
              <PatternCallout
                key={i}
                pattern={p}
                expanded={expandedPatterns.has(i)}
                onToggle={() => togglePattern(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="divide-y divide-border/60">
        {obj.sections.map((section) => {
          const expanded = expandedSections.has(section.id);
          return (
            <div key={section.id} className="px-4 py-2">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-2 text-left py-1 group"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium group-hover:text-primary transition-colors">
                  {section.title}
                </span>
              </button>
              {expanded && (
                <div className="pt-1.5 pb-1 pl-5 prose-chat text-xs leading-relaxed">
                  {section.bullets && section.bullets.length > 0 && (
                    <ul className="list-disc pl-4 space-y-0.5 mb-1.5">
                      {section.bullets.map((b, i) => (
                        <li key={i}>{b.replace(/^-\s*/, "")}</li>
                      ))}
                    </ul>
                  )}
                  <ReactMarkdown>{section.body}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recommended questions */}
      {obj.recommendedQuestions.length > 0 && (
        <div className="px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Suggested next questions
          </div>
          <div className="flex flex-wrap gap-1.5">
            {obj.recommendedQuestions.map((q, i) => (
              <RecommendedQuestionChip key={i} question={q} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pattern callout
// ---------------------------------------------------------------------------

function PatternCallout({
  pattern,
  expanded,
  onToggle,
}: {
  pattern: HiddenPattern;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sev = pattern.severity;
  const sevClass =
    sev === "critical"
      ? "border-destructive/30 bg-destructive/5"
      : sev === "notable"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-blue-500/30 bg-blue-500/5";
  const sevBadge =
    sev === "critical"
      ? "bg-destructive/15 text-destructive"
      : sev === "notable"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  const sevIcon =
    sev === "critical" ? <AlertTriangle className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />;

  return (
    <div className={cn("rounded-lg border px-2.5 py-2", sevClass)}>
      <button onClick={onToggle} className="w-full flex items-start gap-2 text-left">
        <span className={cn("mt-0.5 h-4 w-4 rounded-full flex items-center justify-center shrink-0", sevBadge)}>
          {sevIcon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium">{pattern.title}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono">{pattern.evidence.metric} = <span className="text-foreground font-medium">{pattern.evidence.value}</span></span>
            {pattern.evidence.baseline && (
              <span className="text-muted-foreground/70">({pattern.evidence.baseline})</span>
            )}
            <span className="text-muted-foreground/70">·</span>
            <span className="font-mono truncate">{pattern.columns.join(", ")}</span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-6 text-xs text-foreground/80 leading-relaxed">
          {pattern.description}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommended question chip — clicking sends it to chat
// ---------------------------------------------------------------------------

function RecommendedQuestionChip({ question }: { question: string }) {
  const sessionId = useSession((s) => s.sessionId);
  const addMessage = useSession((s) => s.addMessage);
  const appendToMessage = useSession((s) => s.appendToMessage);
  const addStepToMessage = useSession((s) => s.addStepToMessage);
  const addCanvasObject = useSession((s) => s.addCanvasObject);
  const setFollowUps = useSession((s) => s.setFollowUps);
  const finalizeMessage = useSession((s) => s.finalizeMessage);
  const setSending = useSession((s) => s.setSending);
  const sending = useSession((s) => s.sending);

  async function send() {
    if (!sessionId || sending) return;
    addMessage({ id: crypto.randomUUID(), role: "user", content: question });
    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "", streaming: true, steps: [] });
    setSending(true);
    await streamChat(sessionId, question, {
      onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
      onSql: () => {},
      onCanvas: (o) => addCanvasObject(o),
      onToken: (delta) => appendToMessage(assistantId, delta),
      onFollowUps: (qs) => setFollowUps(assistantId, qs),
      onReplyDone: () => finalizeMessage(assistantId),
      onError: (msg) => {
        appendToMessage(assistantId, `⚠️ ${msg}`);
        finalizeMessage(assistantId, { isError: true });
      },
      onDone: () => {
        finalizeMessage(assistantId);
        setSending(false);
      },
    });
  }

  return (
    <button
      onClick={() => void send()}
      disabled={sending}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent/40 hover:border-primary/30 transition-colors disabled:opacity-50"
      title="Click to ask this question"
    >
      <Sparkles className="h-2.5 w-2.5 text-primary" />
      <span className="truncate max-w-[280px]">{question}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Report → Markdown
// ---------------------------------------------------------------------------

function reportToMarkdown(r: ReportCanvasObject): string {
  const lines: string[] = [];
  lines.push(`# ${r.title}`);
  lines.push("");
  lines.push(`*Generated: ${new Date(r.generatedAt).toLocaleString()} · depth: ${r.depth} · focus: ${r.focus} · ${r.includeTechnicals ? "technical terms on" : "plain English"}*`);
  lines.push("");
  // Dataset summary
  lines.push("## Dataset Summary");
  lines.push("");
  lines.push(`- **Rows**: ${r.datasetSummary.rows.toLocaleString()}`);
  lines.push(`- **Columns**: ${r.datasetSummary.columns}`);
  if (r.datasetSummary.timespan) lines.push(`- **Timespan**: ${r.datasetSummary.timespan}`);
  if (r.datasetSummary.tableNames.length) lines.push(`- **Tables**: ${r.datasetSummary.tableNames.join(", ")}`);
  lines.push("");

  // Key metrics
  if (r.keyMetrics.length) {
    lines.push("## Key Metrics");
    lines.push("");
    for (const m of r.keyMetrics) {
      const trend = m.trend === "up" ? " ↑" : m.trend === "down" ? " ↓" : m.trend === "flat" ? " →" : "";
      lines.push(`- **${m.label}**: ${m.value}${trend}${m.hint ? ` — ${m.hint}` : ""}`);
    }
    lines.push("");
  }

  // Executive summary
  if (r.executiveSummary) {
    lines.push("## Executive Summary");
    lines.push("");
    lines.push(r.executiveSummary);
    lines.push("");
  }

  // Hidden patterns
  if (r.hiddenPatterns.length) {
    lines.push("## Hidden Patterns");
    lines.push("");
    for (const p of r.hiddenPatterns) {
      const sev = p.severity.toUpperCase();
      lines.push(`### ${p.title} \`${sev}\``);
      lines.push("");
      lines.push(p.description);
      lines.push("");
      lines.push(`- **Metric**: ${p.evidence.metric} = ${p.evidence.value}${p.evidence.baseline ? ` (baseline: ${p.evidence.baseline})` : ""}`);
      lines.push(`- **Columns**: ${p.columns.join(", ")}`);
      lines.push("");
    }
  }

  // Sections
  for (const s of r.sections) {
    lines.push(`## ${s.title}`);
    lines.push("");
    if (s.bullets?.length) {
      for (const b of s.bullets) {
        const trimmed = b.replace(/^-\s*/, "");
        lines.push(`- ${trimmed}`);
      }
      lines.push("");
    }
    lines.push(s.body);
    lines.push("");
  }

  // Recommended questions
  if (r.recommendedQuestions.length) {
    lines.push("## Suggested Next Questions");
    lines.push("");
    for (const q of r.recommendedQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
