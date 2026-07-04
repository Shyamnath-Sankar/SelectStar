"use client";

import { useEffect, useState } from "react";
import {
  Database, Loader2, Sparkles, ShieldCheck, Lock, ArrowRight, Zap,
  Clock, Trash2, ChevronRight, Terminal, BarChart3, Brain, GitBranch,
  Check, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { useSession } from "@/lib/store";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface RecentSession {
  id: string;
  label: string;
  dialect: string;
  status: string;
  canWrite: boolean;
  zenMode: boolean;
  updatedAt: string;
}

export function ConnectionScreen() {
  const { connecting, connectError, connect, setConnecting, setConnectError, loadSession } = useSession();
  const [connStr, setConnStr] = useState("demo");
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json();
        setRecent((data.sessions || []).filter((s: RecentSession) => s.status === "connected"));
      } catch {
        /* ignore */
      }
    })();
  }, []);

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

  async function reopenSession(s: RecentSession) {
    setLoadingSession(s.id);
    try {
      const res = await fetch(`/api/sessions/${s.id}`);
      if (!res.ok) throw new Error("Session not found");
      const data = await res.json();
      loadSession({
        sessionId: data.sessionId,
        label: data.label,
        dialect: data.dialect,
        schema: data.schemaSnapshot,
        canWrite: data.canWrite,
        zenMode: data.zenMode,
        suggestedQuestions: data.suggestedQuestions || [],
        messages: (data.messages || []).map((m: { role: string; content: string; id?: string }, i: number) => ({
          id: m.id || `msg-${i}`,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        canvas: data.canvas || [],
      });
      toast.success(`Reopened "${s.label}"`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingSession(null);
    }
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      setRecent((prev) => prev.filter((s) => s.id !== id));
      toast.success("Session deleted");
    } catch {
      toast.error("Couldn't delete session");
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Ambient gradient backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-[24rem] w-[24rem] rounded-full bg-primary/6 blur-3xl" />
        <div className="absolute -bottom-40 right-1/4 h-[20rem] w-[20rem] rounded-full bg-emerald-500/5 blur-3xl" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <main className="relative flex-1 grid lg:grid-cols-2 gap-0 items-stretch">
        {/* ===== LEFT: hero / product story ===== */}
        <section className="hidden lg:flex flex-col justify-between p-12 xl:p-16 border-r border-border/40">
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-2.5"
          >
            <Logo className="h-9 w-9" />
            <span className="font-semibold text-lg tracking-tight">SelectStar</span>
            <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">beta</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="py-10"
          >
            <h1 className="text-4xl xl:text-[3.25rem] font-semibold tracking-tight leading-[1.1]">
              Talk to your database
              <br />
              <span className="text-primary font-medium">in plain English.</span>
            </h1>
            <p className="mt-6 text-[15px] text-muted-foreground/80 leading-relaxed max-w-md">
              Paste a connection string and ask anything. A team of AI agents
              writes the SQL, profiles the data, builds the charts, and runs
              the models — you just read the answers.
            </p>

            {/* Agent pipeline visualization — integrated card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-10 rounded-2xl border border-border/60 bg-gradient-to-br from-card/60 to-card/20 backdrop-blur p-5 max-w-md shadow-lg shadow-black/5"
            >
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground/70 font-semibold mb-4 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                How a question becomes an answer
              </div>
              <div className="flex items-center gap-1 justify-center">
                <AgentBadge icon="🧭" label="Router" delay={0} />
                <Connector />
                <AgentBadge icon="⌘" label="SQL" delay={0.1} />
                <Connector />
                <div className="flex flex-col gap-1">
                  <AgentBadge icon="📊" label="EDA" delay={0.2} small />
                  <AgentBadge icon="📈" label="Viz" delay={0.25} small />
                  <AgentBadge icon="🧠" label="ML" delay={0.3} small />
                </div>
                <Connector />
                <AgentBadge icon="✦" label="Reply" delay={0.35} />
              </div>
              <div className="mt-4 pt-3 border-t border-border/40 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground/70">
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> SQL shown</div>
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Writes gated</div>
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Live canvas</div>
              </div>
            </motion.div>

            {/* Feature highlights */}
            <div className="mt-7 space-y-4 max-w-md">
              <FeatureRow
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Read-only by default"
                desc="Writes need an explicit Zen-mode toggle and per-statement confirmation."
                accent="emerald"
              />
              <FeatureRow
                icon={<Eye className="h-4 w-4" />}
                title="Always inspectable"
                desc="Every SQL statement is shown — never hidden — before and after it runs."
                accent="primary"
              />
              <FeatureRow
                icon={<BarChart3 className="h-4 w-4" />}
                title="Vega-Lite charts, live"
                desc="The viz agent emits declarative specs the canvas renders as SVG instantly."
                accent="amber"
              />
            </div>
          </motion.div>

          <div className="text-xs text-muted-foreground/60 flex items-center gap-4">
            <span className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> Credentials stay server-side</span>
            <span className="flex items-center gap-1.5"><Terminal className="h-3 w-3" /> No code execution in the viz path</span>
          </div>
        </section>

        {/* ===== RIGHT: connection panel ===== */}
        <section className="flex items-center justify-center p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
              <Logo className="h-10 w-10" />
              <span className="font-semibold text-xl tracking-tight">SelectStar</span>
            </div>

            <div className="lg:hidden text-center mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                Talk to your database <span className="text-primary">in plain English.</span>
              </h1>
            </div>

            <h2 className="text-sm font-medium text-muted-foreground mb-1">Connect a database</h2>
            <p className="text-xs text-muted-foreground/70 mb-5">
              Paste a connection string, or pick a quick start below.
            </p>

            <form onSubmit={handleConnect} className="rounded-2xl border border-border bg-card/80 backdrop-blur p-4 shadow-xl shadow-black/5">
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
                Connection string
              </label>
              <div className="relative">
                <Input
                  value={connStr}
                  onChange={(e) => setConnStr(e.target.value)}
                  placeholder="postgresql://user:pass@host:5432/db"
                  className={cn(
                    "font-mono text-sm h-11 pr-10 border-2 transition-colors",
                    "focus-visible:border-primary/50",
                    connectError && "border-destructive/40"
                  )}
                  disabled={connecting}
                  autoFocus
                />
                {connStr && (
                  <button
                    type="button"
                    onClick={() => setConnStr("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    <span className="text-lg leading-none">×</span>
                  </button>
                )}
              </div>

              {/* Quick start options */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <QuickOption label="Demo DB" hint="E-commerce · SQLite" onClick={() => setConnStr("demo")} active={connStr === "demo"} />
                <QuickOption label="PostgreSQL" hint="postgres://…" onClick={() => setConnStr("postgresql://user:pass@host:5432/db")} active={connStr.startsWith("postgres")} />
                <QuickOption label="SQLite file" hint="/path/to.db" onClick={() => setConnStr("sqlite:./my.db")} active={connStr.startsWith("sqlite:")} />
              </div>

              <Button type="submit" disabled={connecting} className="w-full h-11 mt-3 gap-2 font-medium">
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    Connect
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <AnimatePresence>
                {connectError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">⚠</span>
                      <span className="leading-relaxed">{connectError}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Security reassurance */}
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60">
                <Lock className="h-3 w-3" />
                Read-only by default · writes need Zen mode
              </div>
            </form>

            {/* Recent sessions */}
            <AnimatePresence>
              {recent.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-5 overflow-hidden"
                >
                  <div className="text-[11px] font-medium text-muted-foreground/70 mb-2 flex items-center gap-1.5 px-1 uppercase tracking-wide">
                    <Clock className="h-3 w-3" /> Recent sessions
                    <button
                      onClick={() => setShowFull((v) => !v)}
                      className="ml-auto normal-case tracking-normal text-muted-foreground/60 hover:text-foreground transition-colors"
                    >
                      {showFull ? "Show less" : `Show all ${recent.length}`}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {(showFull ? recent : recent.slice(0, 3)).map((s) => (
                      <motion.button
                        key={s.id}
                        onClick={() => reopenSession(s)}
                        disabled={loadingSession === s.id}
                        whileHover={{ x: 2 }}
                        className={cn(
                          "group w-full flex items-center gap-2.5 rounded-xl border border-border bg-card/60 backdrop-blur px-3 py-2.5 text-left hover:border-primary/30 hover:bg-accent/30 transition-all disabled:opacity-60",
                        )}
                      >
                        <div className="h-7 w-7 rounded-lg bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0">
                          <Database className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{s.label}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground bg-muted/60 rounded px-1 py-0.5">{s.dialect}</span>
                            {s.zenMode && (
                              <span className="text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-1 py-0.5">Zen</span>
                            )}
                            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{timeAgo(s.updatedAt)}</span>
                          </div>
                        </div>
                        <span
                          onClick={(e) => deleteSession(s.id, e)}
                          role="button"
                          tabIndex={0}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1 rounded cursor-pointer"
                          title="Delete session"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                        {loadingSession === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                        )}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mobile-only feature list */}
            <div className="lg:hidden mt-6 space-y-3">
              <FeatureRow icon={<ShieldCheck className="h-4 w-4" />} title="Read-only by default" desc="Writes need Zen mode + confirmation." accent="emerald" />
              <FeatureRow icon={<Eye className="h-4 w-4" />} title="Always inspectable" desc="Every SQL statement is shown." accent="primary" />
              <FeatureRow icon={<Zap className="h-4 w-4" />} title="Agent team" desc="Router → SQL → EDA/Viz/ML → Synthesis." accent="amber" />
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative border-t border-border/40 py-3.5 px-6 flex items-center justify-between text-[11px] text-muted-foreground/60">
        <span>Built with Next.js · Vega-Lite · an OpenAI-compatible LLM</span>
        <span className="hidden sm:flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Agentic data analysis
        </span>
      </footer>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function QuickOption({ label, hint, onClick, active }: { label: string; hint: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-2 text-left transition-all hover:scale-[1.02]",
        active ? "border-primary/50 bg-primary/8 shadow-sm shadow-primary/10" : "border-border hover:border-border hover:bg-accent/40"
      )}
    >
      <div className="text-xs font-medium flex items-center gap-1">
        {active && <Check className="h-3 w-3 text-primary" />}
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>
    </button>
  );
}

function AgentBadge({ icon, label, delay, small }: { icon: string; label: string; delay: number; small?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.4 + delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -1 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-background/80 backdrop-blur shadow-sm hover:shadow-md hover:border-primary/30 transition-all",
        small ? "px-2 py-1" : "px-3 py-1.5"
      )}
    >
      <span className={cn("leading-none", small ? "text-xs" : "text-base")}>{icon}</span>
      <span className={cn("font-medium text-foreground/90", small ? "text-[10px]" : "text-xs")}>{label}</span>
    </motion.div>
  );
}

function Connector() {
  return (
    <motion.div
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.3, delay: 0.5 }}
      className="h-px w-4 bg-gradient-to-r from-border via-primary/40 to-primary/60 origin-left shrink-0"
    />
  );
}

function FeatureRow({ icon, title, desc, accent = "primary" }: { icon: React.ReactNode; title: string; desc: string; accent?: "primary" | "emerald" | "amber" }) {
  const accentClasses = {
    primary: "bg-primary/8 border-primary/15 text-primary",
    emerald: "bg-emerald-500/8 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/8 border-amber-500/20 text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="flex items-start gap-3">
      <div className={cn("h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5", accentClasses[accent])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
