"use client";

import { useState } from "react";
import { Database, Loader2, Sparkles, ShieldCheck, Lock, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/store";
import { toast } from "sonner";
import { motion } from "framer-motion";

export function ConnectionScreen() {
  const { connecting, connectError, connect, setConnecting, setConnectError } = useSession();
  const [connStr, setConnStr] = useState("demo");

  async function handleConnect(e?: React.FormEvent) {
    e?.preventDefault();
    if (!connStr.trim()) {
      toast.error("Please enter a connection string.");
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString: connStr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || "Connection failed");
        toast.error(data.error || "Connection failed");
        return;
      }
      connect({
        sessionId: data.sessionId,
        label: data.dialect === "sqlite" && /demo/i.test(connStr) ? "Demo E-commerce DB" : `${data.dialect} session`,
        dialect: data.dialect,
        schema: data.schema,
        canWrite: data.canWrite,
        suggestedQuestions: data.suggestedQuestions,
      });
      toast.success(`Connected — ${data.schema.tables.length} tables found.`);
    } catch (e) {
      setConnectError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Subtle gradient backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <main className="relative flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-xl"
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Database className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Quill</h1>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
              Paste a database connection string. Ask questions in plain English.
              Get answers, charts, and models — rendered live by an agent team.
            </p>
          </div>

          <form onSubmit={handleConnect} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Connection string
            </label>
            <div className="flex gap-2">
              <Input
                value={connStr}
                onChange={(e) => setConnStr(e.target.value)}
                placeholder="postgresql://user:pass@host:5432/db  ·  or just “demo”"
                className="font-mono text-sm h-10"
                disabled={connecting}
                autoFocus
              />
              <Button type="submit" disabled={connecting} className="h-10 gap-1.5 shrink-0">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {connecting ? "Connecting" : "Connect"}
              </Button>
            </div>

            {connectError && (
              <p className="mt-2.5 text-xs text-destructive flex items-start gap-1.5">
                <span className="leading-relaxed">{connectError}</span>
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2">
              <QuickOption label="Demo DB" hint="E-commerce · SQLite" onClick={() => setConnStr("demo")} active={connStr === "demo"} />
              <QuickOption label="PostgreSQL" hint="postgres://…" onClick={() => setConnStr("postgresql://user:pass@host:5432/db")} />
              <QuickOption label="SQLite file" hint="/path/to.db" onClick={() => setConnStr("sqlite:./my.db")} />
            </div>
          </form>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <Feature icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Read-only by default">
              Writes need an explicit Zen-mode toggle.
            </Feature>
            <Feature icon={<Lock className="h-3.5 w-3.5" />} title="Always inspectable">
              Every SQL statement is shown before & after it runs.
            </Feature>
            <Feature icon={<Zap className="h-3.5 w-3.5" />} title="Agent team">
              Router, SQL, EDA, Viz & ML agents collaborate per turn.
            </Feature>
          </div>
        </motion.div>
      </main>

      <footer className="relative border-t border-border/50 py-4 px-6 text-center text-xs text-muted-foreground">
        Built with Next.js · Vega-Lite · an OpenAI-compatible LLM
      </footer>
    </div>
  );
}

function QuickOption({ label, hint, onClick, active }: { label: string; hint: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-accent/50 ${
        active ? "border-primary/40 bg-primary/5" : "border-border"
      }`}
    >
      <div className="text-xs font-medium flex items-center gap-1">
        {active && <Sparkles className="h-3 w-3 text-primary" />}
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-foreground font-medium mb-1">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <p className="text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
