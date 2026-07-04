"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Loader2, User, Sparkles, RotateCcw, AlertCircle, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSession, type ChatMessage } from "@/lib/store";
import { streamChat } from "@/lib/chat-client";
import type { AgentName } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const AGENT_ICONS: Record<AgentName, string> = {
  router: "🧭",
  schema: "🗃️",
  sql: "⌘",
  eda: "📊",
  viz: "📈",
  ml: "🧠",
  synthesis: "✦",
};

export function ChatPane() {
  const {
    sessionId, messages, sending, zenMode, schema, suggestedQuestions,
    addMessage, appendToMessage, addStepToMessage, finalizeMessage,
    setSending, addCanvasObject, reset,
  } = useSession();
  const sessionLabel = useSession((s) => s.label);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom as new content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

    await streamChat(sessionId, content, {
      onStep: (agent, label) => addStepToMessage(assistantId, { agent, label }),
      onSql: () => {
        /* SQL block is rendered as a canvas object via onCanvas */
      },
      onCanvas: (obj) => addCanvasObject(obj),
      onToken: (delta) => appendToMessage(assistantId, delta),
      onReplyDone: () => finalizeMessage(assistantId),
      onError: (message) => {
        appendToMessage(assistantId, `⚠️ ${message}`);
        finalizeMessage(assistantId, { isError: true });
      },
      onDone: () => {
        finalizeMessage(assistantId);
        setSending(false);
      },
    });
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
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5 text-xs" onClick={() => { reset(); }}>
          <RotateCcw className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {hasMessages ? (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </AnimatePresence>
        ) : (
          <EmptyState
            schema={schema}
            suggestedQuestions={suggestedQuestions}
            onPick={(q) => void send(q)}
          />
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
            placeholder={zenMode ? "Ask anything — Zen mode is on, writes allowed (with confirmation)…" : "Ask a question about your data…"}
            className="min-h-[44px] max-h-40 resize-none pr-12 text-sm leading-relaxed"
            disabled={sending}
          />
          <Button
            size="icon"
            className="absolute bottom-2 right-2 h-8 w-8"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            aria-label="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground px-1">
          Enter to send · Shift+Enter for a newline
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex gap-2.5", isUser && "flex-row-reverse")}
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
            <div className={cn("prose-chat", isUser && "[&p]:my-0")}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {message.streaming && <span className="streaming-caret" />}
            </div>
          ) : message.streaming ? (
            <span className="text-muted-foreground text-xs italic">thinking…</span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState({
  schema,
  suggestedQuestions,
  onPick,
}: {
  schema: { tables: { name: string; rowCount: number }[] } | null;
  suggestedQuestions: string[];
  onPick: (q: string) => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
        <Database className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-medium text-sm">Ready when you are</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        {schema
          ? `Connected to ${schema.tables.length} tables. Try one of these to get going:`
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
        </div>
      )}
    </div>
  );
}
