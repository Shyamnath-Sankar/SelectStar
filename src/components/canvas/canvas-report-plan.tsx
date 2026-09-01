"use client";

import { useState } from "react";
import { FileText, Sparkles, Loader2, ChevronRight, Check, FlaskConical } from "lucide-react";
import type { ReportPlanCanvasObject } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/store";
import { streamChat } from "@/lib/chat-client";
import { toast } from "sonner";
import { GENERATE_REPORT_PREFIX } from "@/lib/agents/report-constants";

/**
 * The interactive report-plan canvas card.
 *
 * Renders the focus / depth / section options the report planner produced,
 * lets the user pick one of each, then sends a structured
 * `__GENERATE_REPORT__ {...}` chat message back to the orchestrator when the
 * user clicks "Generate Report".
 *
 * This is the human-in-the-loop gate — no analysis happens until the user
 * has confirmed what they want.
 */
export function CanvasReportPlan({ obj }: { obj: ReportPlanCanvasObject }) {
  const [focus, setFocus] = useState(obj.defaultFocus);
  const [depth, setDepth] = useState(obj.defaultDepth);
  const [sections, setSections] = useState<Set<string>>(new Set(obj.defaultSections));
  // Default to plain English (includeTechnicals === false) unless the plan
  // explicitly opted in. The user can flip this on to get the technical terms.
  const [includeTechnicals, setIncludeTechnicals] = useState<boolean>(
    obj.defaultIncludeTechnicals === true
  );
  const [submitting, setSubmitting] = useState(false);

  const sessionId = useSession((s) => s.sessionId);
  const addMessage = useSession((s) => s.addMessage);
  const appendToMessage = useSession((s) => s.appendToMessage);
  const addStepToMessage = useSession((s) => s.addStepToMessage);
  const addCanvasObject = useSession((s) => s.addCanvasObject);
  const addInlineArtifact = useSession((s) => s.addInlineArtifact);
  const setFollowUps = useSession((s) => s.setFollowUps);
  const finalizeMessage = useSession((s) => s.finalizeMessage);
  const setSending = useSession((s) => s.setSending);

  function toggleSection(id: string) {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (!sessionId) return;
    if (sections.size === 0) {
      toast.error("Pick at least one section to include.");
      return;
    }
    setSubmitting(true);
    setSending(true);

    // Add a visible user message so the chat reflects their action.
    const focusLabel = obj.focusOptions.find((o) => o.id === focus)?.label ?? focus;
    const depthLabel = obj.depthOptions.find((o) => o.id === depth)?.label ?? depth;
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `Generate the report — focus: ${focusLabel}, depth: ${depthLabel}, sections: ${[...sections].join(", ")}${includeTechnicals ? ", technicals: on" : ", technicals: off"}`,
    });

    // Add a streaming placeholder for the assistant reply.
    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "", streaming: true, steps: [] });

    const payload = {
      focus,
      depth,
      sections: [...sections],
      includeTechnicals,
    };
    const message = `${GENERATE_REPORT_PREFIX} ${JSON.stringify(payload)}`;

    try {
      await streamChat(
        sessionId,
        message,
        {
          onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
          onSql: () => {},
          onCanvas: (o) => {
            // The report generator emits a `report` canvas object — that
            // goes to the canvas pane. Any nested HITL artifact (rare here)
            // is attached inline to the chat bubble.
            if (o.type === "pending_write" || o.type === "report_plan") {
              addInlineArtifact(assistantId, o);
            } else {
              addCanvasObject(o);
            }
          },
          onToken: (delta) => appendToMessage(assistantId, delta),
          onFollowUps: (qs) => setFollowUps(assistantId, qs),
          onReplyDone: () => finalizeMessage(assistantId),
          onError: (msg) => {
            appendToMessage(assistantId, `⚠️ ${msg}`);
            finalizeMessage(assistantId, { isError: true });
            toast.error(msg);
          },
          onDone: () => {
            finalizeMessage(assistantId);
            setSending(false);
            setSubmitting(false);
          },
        }
      );
    } catch (e) {
      const msg = (e as Error).message || String(e);
      appendToMessage(assistantId, `⚠️ ${msg}`);
      finalizeMessage(assistantId, { isError: true });
      setSending(false);
      setSubmitting(false);
      toast.error(msg);
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/20 bg-primary/5">
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <FileText className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{obj.title}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">{obj.contextNote}</div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Focus */}
        <OptionGroup
          label="Focus"
          hint="What should the report emphasize?"
          options={obj.focusOptions}
          selected={focus}
          onSelect={setFocus}
          layout="grid"
        />

        {/* Depth */}
        <OptionGroup
          label="Depth"
          hint="How thorough should the analysis be?"
          options={obj.depthOptions}
          selected={depth}
          onSelect={setDepth}
          layout="row"
        />

        {/* Sections */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <div className="text-xs font-medium text-foreground">Sections to include</div>
              <div className="text-[10px] text-muted-foreground">Pick the ones you want — others will be skipped.</div>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{sections.size} selected</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {obj.sectionOptions.map((opt) => {
              const checked = sections.has(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleSection(opt.id)}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    checked
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-background hover:bg-accent/40"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium flex items-center gap-1">
                      {opt.label}
                      {opt.recommended && (
                        <span className="text-[9px] uppercase tracking-wide text-primary/70">recommended</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2">{opt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Include technical terms toggle.
            Default OFF — the report is plain English with no statistical
            jargon (no "correlation", "skew", "outlier", "R²", etc.). The
            user can flip this ON to get the proper technical terms. */}
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <FlaskConical className={cn("h-4 w-4 mt-0.5 shrink-0", includeTechnicals ? "text-primary" : "text-muted-foreground")} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium flex items-center gap-1.5">
              Include technical terms
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
                {includeTechnicals ? "on" : "off · plain English"}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              {includeTechnicals
                ? "The report will use proper statistical terms (correlation, Pearson r, skew, outlier, k-means, R², etc.) with brief explanations."
                : "The report will be written in everyday language — no statistical jargon. Relationships become \"move together\", outliers become \"unusual values\", clusters become \"natural groups\"."}
            </div>
          </div>
          <Switch
            checked={includeTechnicals}
            onCheckedChange={setIncludeTechnicals}
            className="scale-90 mt-0.5"
            aria-label="Include technical terms in the report"
          />
        </div>

        {/* Generate button */}
        <div className="pt-1 flex items-center justify-between gap-2 border-t border-border/60">
          <div className="text-[10px] text-muted-foreground">
            {sections.size === 0
              ? "Pick at least one section."
              : `Ready to analyze with ${sections.size} section${sections.size === 1 ? "" : "s"}.`}
          </div>
          <Button
            size="sm"
            onClick={() => void generate()}
            disabled={submitting || sections.size === 0}
            className="gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Generate Report
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option group helper
// ---------------------------------------------------------------------------

function OptionGroup({
  label,
  hint,
  options,
  selected,
  onSelect,
  layout,
}: {
  label: string;
  hint: string;
  options: { id: string; label: string; description: string; recommended?: boolean }[];
  selected: string;
  onSelect: (id: string) => void;
  layout: "row" | "grid";
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs font-medium text-foreground">{label}</div>
          <div className="text-[10px] text-muted-foreground">{hint}</div>
        </div>
      </div>
      <div
        className={cn(
          "gap-1.5",
          layout === "row" ? "flex flex-wrap" : "grid grid-cols-1 sm:grid-cols-2"
        )}
      >
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition-colors min-w-0",
                layout === "row" ? "flex-1" : "",
                active
                  ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                  : "border-border bg-background hover:bg-accent/40"
              )}
            >
              <div className="text-xs font-medium flex items-center gap-1">
                {opt.label}
                {opt.recommended && (
                  <span className="text-[9px] uppercase tracking-wide text-primary/70">recommended</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground line-clamp-2">{opt.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
