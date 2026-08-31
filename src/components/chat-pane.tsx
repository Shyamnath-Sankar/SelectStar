"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Loader2, User, Sparkles, RotateCcw, AlertCircle, Database, Copy, RefreshCw, Check, Square, ArrowDown, FileSpreadsheet, FileText, Lightbulb, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSession, type ChatMessage } from "@/lib/store";
import { streamChat } from "@/lib/chat-client";
import type { AgentName, CanvasObject } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { CanvasObjectView } from "@/components/canvas/canvas-object";

const AGENT_ICONS: Record<AgentName, string> = {
  router: "🧭",
  schema: "🗃️",
  sql: "⌘",
  eda: "📊",
  viz: "📈",
  ml: "🧠",
  report: "📝",
  synthesis: "✦",
};

/**
 * Routes a streamed canvas object to the right surface.
 *
 * Human-in-the-loop artifacts (pending_write, report_plan) are attached to the
 * streaming assistant message as `inlineArtifacts` so they render INSIDE the
 * chat bubble — the user never has to switch to the canvas pane to confirm a
 * write or pick report options. Every other canvas object type goes through
 * `addCanvasObject` and lands in the canvas pane as before.
 */
function routeCanvasObject(
  assistantId: string,
  obj: CanvasObject,
  addInlineArtifact: (id: string, o: CanvasObject) => void,
  addCanvasObject: (o: CanvasObject) => void,
) {
  if (obj.type === "pending_write" || obj.type === "report_plan") {
    addInlineArtifact(assistantId, obj);
  } else {
    addCanvasObject(obj);
  }
}

export function ChatPane() {
  const {
    sessionId, messages, sending, zenMode, schema, suggestedQuestions,
    addMessage, appendToMessage, addStepToMessage, finalizeMessage,
    setSending, addCanvasObject, addInlineArtifact, reset, popLastAssistant, setFollowUps,
  } = useSession();
  const sessionLabel = useSession((s) => s.label);
  const mode = useSession((s) => s.mode);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Auto-scroll to bottom as new content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Track whether the user has scrolled up, to show a scroll-to-bottom button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollDown(distFromBottom > 120);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || !sessionId || sending) return;
    setInput("");

    // Add the user message.
    addMessage({ id: crypto.randomUUID(), role: "user", content });

    // Add a placeholder assistant message we'll stream into.
    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "", streaming: true, steps: [] });
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(sessionId, content, {
      onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
      onSql: () => {
        /* SQL block is rendered as a canvas object via onCanvas */
      },
      onCanvas: (obj) => routeCanvasObject(assistantId, obj, addInlineArtifact, addCanvasObject),
      onToken: (delta) => appendToMessage(assistantId, delta),
      onFollowUps: (questions) => setFollowUps(assistantId, questions),
      onReplyDone: () => finalizeMessage(assistantId),
      onError: (message) => {
        appendToMessage(assistantId, `⚠️ ${message}`);
        finalizeMessage(assistantId, { isError: true });
      },
      onDone: () => {
        finalizeMessage(assistantId);
        setSending(false);
        abortRef.current = null;
      },
    }, controller.signal);
  }

  async function regenerate() {
    if (!sessionId || sending) return;
    const userContent = popLastAssistant();
    if (!userContent) return;
    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "", streaming: true, steps: [] });
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(sessionId, userContent, {
      onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
      onSql: () => {},
      onCanvas: (obj) => routeCanvasObject(assistantId, obj, addInlineArtifact, addCanvasObject),
      onToken: (delta) => appendToMessage(assistantId, delta),
      onFollowUps: (questions) => setFollowUps(assistantId, questions),
      onReplyDone: () => finalizeMessage(assistantId),
      onError: (message) => {
        appendToMessage(assistantId, `⚠️ ${message}`);
        finalizeMessage(assistantId, { isError: true });
      },
      onDone: () => {
        finalizeMessage(assistantId);
        setSending(false);
        abortRef.current = null;
      },
    }, controller.signal);
  }

  function stopGenerating() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setSending(false);
      // Finalize any streaming message.
      const streaming = useSession.getState().messages.find((m) => m.streaming);
      if (streaming) finalizeMessage(streaming.id);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">Chat</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground truncate">{sessionLabel}</span>

        {/* One-click shortcuts — surface the report agent's most useful modes
            so non-expert users don't have to remember the keywords. */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => void send("What should I know? Surface the hidden patterns and tell me what matters most in this data.")}
            disabled={sending}
            title="One-click: surface hidden patterns and tell you what matters most."
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            <span className="hidden sm:inline">What should I know?</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => void send("What changed? Compare the most recent period to the prior period across every key metric and tell me the biggest movers.")}
            disabled={sending}
            title="One-click: period-over-period diff, biggest movers."
          >
            <GitCompare className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">What changed?</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { reset(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> New
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0 relative">
        {hasMessages ? (
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isLastAssistant={i === messages.length - 1 && m.role === "assistant" && !m.streaming}
                onRegenerate={regenerate}
              />
            ))}
          </AnimatePresence>
        ) : (
          <EmptyState
            schema={schema}
            suggestedQuestions={suggestedQuestions}
            onPick={(q) => void send(q)}
            mode={mode}
          />
        )}
        {showScrollDown && (
          <button
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            className="sticky bottom-2 left-full ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border shadow-md hover:bg-accent transition-colors z-10"
            title="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "classic"
                ? zenMode
                  ? "Ask the SelectStar Classic assistant — Zen mode is on, edits allowed (with confirmation)…"
                  : "Ask the SelectStar Classic assistant about your data…"
                : zenMode
                  ? "Ask anything — Zen mode is on, writes allowed (with confirmation)…"
                  : "Ask a question about your data…"
            }
            className="min-h-[44px] max-h-40 resize-none pr-12 text-sm leading-relaxed"
            disabled={sending}
          />
          {sending ? (
            <Button
              size="icon"
              variant="destructive"
              className="absolute bottom-2 right-2 h-8 w-8"
              onClick={stopGenerating}
              aria-label="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="absolute bottom-2 right-2 h-8 w-8"
              onClick={() => void send()}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground px-1">
          Enter to send · Shift+Enter for a newline
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isLastAssistant,
  onRegenerate,
}: {
  message: ChatMessage;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  function copyMessage() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex gap-2.5 group", isUser && "flex-row-reverse")}
    >
      <div className={cn(
        "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
        isUser ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground border border-border"
      )}>
        {isUser ? <User className="h-3.5 w-3.5" /> : message.isError ? <AlertCircle className="h-3.5 w-3.5 text-destructive" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
      </div>
      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {message.steps && message.steps.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {message.steps.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <span>{AGENT_ICONS[s.agent]}</span>
                {s.label}
                {i === message.steps!.length - 1 && message.streaming && (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                )}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-full",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : message.isError
              ? "bg-destructive/10 text-destructive rounded-tl-sm"
              : "bg-card border border-border rounded-tl-sm",
            message.streaming && !message.content && "text-muted-foreground"
          )}
        >
          {message.content ? (
            <div className={cn("prose-chat", isUser && "[&>p]:my-0")}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {message.streaming && <span className="streaming-caret" />}
            </div>
          ) : message.streaming ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs italic">
              thinking
              <span className="inline-flex items-center gap-0.5 not-italic">
                <span className="think-dot" />
                <span className="think-dot" />
                <span className="think-dot" />
              </span>
            </span>
          ) : null}
        </div>
        {/* Inline HITL artifacts — pending_write and report_plan render here,
            NOT on the canvas pane. The user confirms writes and picks report
            options right inside the chat conversation. */}
        {!isUser && message.inlineArtifacts && message.inlineArtifacts.length > 0 && (
          <div className="mt-2 space-y-2 max-w-full">
            {message.inlineArtifacts.map((obj, i) => (
              <InlineArtifact key={i} obj={obj} />
            ))}
          </div>
        )}
        {/* Action bar for completed assistant messages */}
        {!isUser && !message.streaming && message.content && (
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={copyMessage}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {isLastAssistant && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            )}
          </div>
        )}
        {/* Follow-up question chips — surfaced after every completed assistant reply.
            A non-expert never has to figure out what to ask next. */}
        {!isUser && !message.streaming && message.followUps && message.followUps.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1 items-start">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70 px-0.5">
              Try asking next
            </div>
            <div className="flex flex-wrap gap-1">
              {message.followUps.map((q, i) => (
                <FollowUpChip key={i} question={q} />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * A clickable follow-up question chip. Clicking sends the question as a new
 * user message — the orchestrator handles it through the normal pipeline.
 */
function FollowUpChip({ question }: { question: string }) {
  const sessionId = useSession((s) => s.sessionId);
  const sending = useSession((s) => s.sending);
  const addMessage = useSession((s) => s.addMessage);
  const appendToMessage = useSession((s) => s.appendToMessage);
  const addStepToMessage = useSession((s) => s.addStepToMessage);
  const addCanvasObject = useSession((s) => s.addCanvasObject);
  const addInlineArtifact = useSession((s) => s.addInlineArtifact);
  const finalizeMessage = useSession((s) => s.finalizeMessage);
  const setFollowUps = useSession((s) => s.setFollowUps);
  const setSending = useSession((s) => s.setSending);

  async function send() {
    if (!sessionId || sending) return;
    addMessage({ id: crypto.randomUUID(), role: "user", content: question });
    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "", streaming: true, steps: [] });
    setSending(true);
    await streamChat(sessionId, question, {
      onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
      onSql: () => {},
      onCanvas: (o) => routeCanvasObject(assistantId, o, addInlineArtifact, addCanvasObject),
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
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent/40 hover:border-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title="Click to ask this question"
    >
      <Sparkles className="h-2.5 w-2.5 text-primary" />
      <span className="truncate max-w-[260px]">{question}</span>
    </button>
  );
}

/**
 * Renders a HITL artifact (pending_write or report_plan) inline inside the
 * chat bubble. Reuses the same canvas component so the UI is identical to
 * what the canvas pane used to show — just hosted inside the chat
 * conversation instead.
 */
function InlineArtifact({ obj }: { obj: CanvasObject }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl"
    >
      <CanvasObjectView obj={obj} />
    </motion.div>
  );
}

function EmptyState({
  schema,
  suggestedQuestions,
  onPick,
  mode,
}: {
  schema: { tables: { name: string; rowCount: number }[] } | null;
  suggestedQuestions: string[];
  onPick: (q: string) => void;
  mode?: "sql" | "classic";
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
        {mode === "classic" ? (
          <FileSpreadsheet className="h-6 w-6 text-primary" />
        ) : (
          <Database className="h-6 w-6 text-primary" />
        )}
      </div>
      <h3 className="font-medium text-sm">Ready when you are</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        {schema
          ? mode === "classic"
            ? `Loaded ${schema.tables[0]?.rowCount.toLocaleString() ?? 0} rows across ${schema.tables[0]?.name ?? "the dataset"}. Try one of these to get going:`
            : `Connected to ${schema.tables.length} tables. Try one of these to get going:`
          : "Ask a question about your data."}
      </p>
      {suggestedQuestions.length > 0 && (
        <div className="mt-4 w-full max-w-sm space-y-1.5">
          {suggestedQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => onPick(q)}
              className="w-full text-left rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-accent/50 hover:border-primary/30 transition-colors flex items-center gap-2 group"
            >
              <Sparkles className="h-3 w-3 text-primary shrink-0 group-hover:scale-110 transition-transform" />
              <span className="flex-1">{q}</span>
            </button>
          ))}
          {/* One-tap entry point for the report agent — surfaces the feature
              so non-expert users discover it without typing the keyword. */}
          <button
            onClick={() => onPick("Give me a report on this data — surface hidden patterns and tell me what I should know.")}
            className="w-full text-left rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-xs hover:bg-primary/10 hover:border-primary/50 transition-colors flex items-center gap-2 group"
          >
            <FileText className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-110 transition-transform" />
            <span className="flex-1 font-medium">Generate a full report with hidden-pattern analysis</span>
            <span className="text-[9px] uppercase tracking-wide text-primary/70 shrink-0">new</span>
          </button>
        </div>
      )}
    </div>
  );
}
