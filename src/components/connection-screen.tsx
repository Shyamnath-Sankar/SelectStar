"use client";

import { useEffect, useState } from "react";
import {
  Database, Loader2, Sparkles, ShieldCheck, Lock, ArrowRight, Zap,
  Clock, Trash2, ChevronRight, Terminal, BarChart3,
  Check, Eye, FileSpreadsheet, Upload, Table2, Download, Brain, GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { useSession } from "@/lib/store";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AppMode } from "@/lib/types";

interface RecentSession {
  id: string;
  label: string;
  dialect: string;
  mode?: string;
  status: string;
  canWrite: boolean;
  zenMode: boolean;
  updatedAt: string;
}

/**
 * ConnectionScreen — redesigned for a cleaner first-run experience.
 *
 * Single-column hero on top, prominent two-card mode picker below, then the
 * mode-specific form (DB connection string OR file upload). Recent sessions
 * collapse to a compact strip at the bottom. The goal: a user lands on the
 * page, picks a mode in one click, fills one field, hits Connect.
 */
export function ConnectionScreen() {
  const { connecting, connectError, connect, setConnecting, setConnectError, loadSession } = useSession();
  const [mode, setMode] = useState<AppMode>("sql");
  const [connStr, setConnStr] = useState("demo");
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json();
        setRecent((data.sessions || []).filter((s: RecentSession) => s.status === "connected"));
      } catch { /* ignore */ }
    })();
  }, []);

  // ---- SQL mode: connect to a database via connection string -----------
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
        mode: "sql",
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

  // ---- Classic mode: upload CSV/XLSX file(s) ---------------------------
  async function handleUpload(file: File) {
    setUploadingFile(file);
    setUploading(true);
    setConnectError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/classic/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || "Upload failed");
        toast.error(data.error || "Upload failed");
        return;
      }
      connect({
        sessionId: data.sessionId,
        mode: "classic",
        label: data.label,
        dialect: data.dialect,
        schema: data.schema,
        canWrite: true,
        suggestedQuestions: data.suggestedQuestions,
      });
      const tableCount = data.schema.tables.length;
      const totalRows = data.schema.tables.reduce((s: number, t: { rowCount: number }) => s + t.rowCount, 0);
      toast.success(`Loaded ${tableCount} ${tableCount === 1 ? "table" : "tables"} · ${totalRows.toLocaleString()} rows from ${file.name}.`);
    } catch (e) {
      setConnectError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  // Multi-file upload — accept an array of files.
  async function handleUploadMultiple(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploadingFile(arr[0]);
    setUploading(true);
    setConnectError(null);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f);
      const res = await fetch("/api/classic/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || "Upload failed");
        toast.error(data.error || "Upload failed");
        return;
      }
      connect({
        sessionId: data.sessionId,
        mode: "classic",
        label: data.label,
        dialect: data.dialect,
        schema: data.schema,
        canWrite: true,
        suggestedQuestions: data.suggestedQuestions,
      });
      const tableCount = data.schema.tables.length;
      const totalRows = data.schema.tables.reduce((s: number, t: { rowCount: number }) => s + t.rowCount, 0);
      toast.success(`Loaded ${tableCount} ${tableCount === 1 ? "table" : "tables"} · ${totalRows.toLocaleString()} rows from ${arr.length} ${arr.length === 1 ? "file" : "files"}.`);
    } catch (e) {
      setConnectError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 1) {
      void handleUploadMultiple(files);
    } else if (files && files.length === 1) {
      void handleUpload(files[0]);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length) void handleUploadMultiple(files);
  }

  async function reopenSession(s: RecentSession) {
    setLoadingSession(s.id);
    try {
      const res = await fetch(`/api/sessions/${s.id}`);
      if (!res.ok) throw new Error("Session not found");
      const data = await res.json();
      loadSession({
        sessionId: data.sessionId,
        mode: data.mode === "classic" ? "classic" : "sql",
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
      {/* Ambient gradient backdrop — changes with mode */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className={cn(
          "absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full blur-3xl transition-colors duration-500",
          mode === "classic" ? "bg-primary/15" : "bg-primary/12"
        )} />
        <div className={cn(
          "absolute top-1/3 -left-40 h-[24rem] w-[24rem] rounded-full blur-3xl transition-colors duration-500",
          mode === "classic" ? "bg-primary/8" : "bg-primary/6"
        )} />
        <div className="absolute -bottom-40 right-1/4 h-[20rem] w-[20rem] rounded-full bg-emerald-500/5 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <main className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-2xl">
          {/* ===== Hero ===== */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8"
          >
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <Logo className="h-10 w-10" />
              <span className="font-semibold text-2xl tracking-tight">SelectStar</span>
              <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium bg-muted/60 rounded px-1.5 py-0.5">beta</span>
            </div>
            <AnimatePresence mode="wait">
              {mode === "sql" ? (
                <motion.div
                  key="sql-hero"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                >
                  <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.15]">
                    Talk to your database
                    <br />
                    <span className="text-primary font-medium">in plain English.</span>
                  </h1>
                  <p className="mt-3 text-sm sm:text-[15px] text-muted-foreground/80 leading-relaxed max-w-md mx-auto">
                    Paste a connection string and ask anything. AI agents write the SQL,
                    profile the data, and build the charts.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="classic-hero"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                >
                  <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.15]">
                    Drop a spreadsheet,
                    <br />
                    <span className="text-primary font-medium">ask anything.</span>
                  </h1>
                  <p className="mt-3 text-sm sm:text-[15px] text-muted-foreground/80 leading-relaxed max-w-md mx-auto">
                    Upload a CSV or XLSX and the same agent team analyses it — profiles,
                    charts, models, and (in Zen mode) edits the data directly.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ===== Mode picker — two prominent cards ===== */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="grid grid-cols-2 gap-3 mb-6"
          >
            <ModeCard
              active={mode === "sql"}
              onClick={() => { setMode("sql"); setConnectError(null); }}
              icon={<Database className="h-5 w-5" />}
              title="SelectStar"
              subtitle="SQL · Postgres · SQLite"
              accent="primary"
            />
            <ModeCard
              active={mode === "classic"}
              onClick={() => { setMode("classic"); setConnectError(null); }}
              icon={<FileSpreadsheet className="h-5 w-5" />}
              title="SelectStar Classic"
              subtitle="CSV · XLSX files"
              accent="amber"
            />
          </motion.div>

          {/* ===== Form card ===== */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="rounded-2xl border border-border bg-card/80 backdrop-blur p-5 shadow-xl shadow-black/5"
          >
            <AnimatePresence mode="wait">
              {mode === "sql" ? (
                <motion.div
                  key="sql-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <form onSubmit={handleConnect}>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
                      Connection string
                    </label>
                    <div className="relative">
                      <Input
                        value={connStr}
                        onChange={(e) => setConnStr(e.target.value)}
                        placeholder="postgresql://user:pass@host:5432/db"
                        className={cn(
                          "font-mono text-sm h-12 pr-10 border-2 transition-colors",
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          <span className="text-lg leading-none">×</span>
                        </button>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <QuickOption label="Demo DB" hint="E-commerce · SQLite" onClick={() => setConnStr("demo")} active={connStr === "demo"} />
                      <QuickOption label="PostgreSQL" hint="postgres://…" onClick={() => setConnStr("postgresql://user:pass@host:5432/db")} active={connStr.startsWith("postgres")} />
                      <QuickOption label="SQLite file" hint="/path/to.db" onClick={() => setConnStr("sqlite:./my.db")} active={connStr.startsWith("sqlite:")} />
                    </div>

                    <Button type="submit" disabled={connecting} className="w-full h-11 mt-3 gap-2 font-medium">
                      {connecting ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                      ) : (
                        <>Connect <ArrowRight className="h-4 w-4" /></>
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

                    <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60">
                      <Lock className="h-3 w-3" />
                      Read-only by default · writes need Zen mode
                    </div>
                  </form>
                </motion.div>
              ) : (
                <motion.div
                  key="classic-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                    className={cn(
                      "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                      dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    )}
                  >
                    <input
                      id="classic-file-input"
                      type="file"
                      accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.ods"
                      multiple
                      className="hidden"
                      onChange={onFileInput}
                    />
                    <motion.div
                      animate={{ scale: dragActive ? 1.05 : 1 }}
                      className="h-14 w-14 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3"
                    >
                      {uploading ? (
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                      ) : (
                        <Upload className="h-6 w-6 text-primary" />
                      )}
                    </motion.div>
                    <div className="text-sm font-medium">
                      {uploading
                        ? `Loading ${uploadingFile?.name ?? ""}…`
                        : "Drag file(s) here, or"}
                    </div>
                    {!uploading && (
                      <label
                        htmlFor="classic-file-input"
                        className="inline-flex items-center gap-1.5 mt-2 rounded-lg border border-primary/40 bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/12 cursor-pointer transition-colors"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Choose files
                      </label>
                    )}
                    <div className="mt-3 text-[10px] text-muted-foreground/60">
                      .csv · .tsv · .xlsx · .xlsm · .xlsb · .ods · up to 25 MB each · multiple files supported
                    </div>
                  </div>

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

                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <Lock className="h-3 w-3" />
                    File parsed server-side · edits stay in memory
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ===== Feature highlights — compact, mode-aware ===== */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-6 grid grid-cols-3 gap-3"
          >
            {mode === "sql" ? (
              <>
                <FeaturePill icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Read-only by default" />
                <FeaturePill icon={<Eye className="h-3.5 w-3.5" />} label="Always inspectable" />
                <FeaturePill icon={<BarChart3 className="h-3.5 w-3.5" />} label="Vega-Lite charts" />
              </>
            ) : (
              <>
                <FeaturePill icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="CSV & XLSX parsed" />
                <FeaturePill icon={<Table2 className="h-3.5 w-3.5" />} label="Excel-like editing" />
                <FeaturePill icon={<Download className="h-3.5 w-3.5" />} label="Download edited file" />
              </>
            )}
          </motion.div>

          {/* ===== Recent sessions — collapsible strip ===== */}
          {recent.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-6"
            >
              <button
                onClick={() => setShowRecent((v) => !v)}
                className="w-full flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide hover:text-foreground transition-colors"
              >
                <Clock className="h-3 w-3" />
                Recent sessions
                <span className="text-muted-foreground/50 normal-case tracking-normal">({recent.length})</span>
                <ChevronRight className={cn("h-3 w-3 ml-auto transition-transform", showRecent && "rotate-90")} />
              </button>
              <AnimatePresence>
                {showRecent && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1.5 pt-1">
                      {recent.map((s) => (
                        <motion.button
                          key={s.id}
                          onClick={() => reopenSession(s)}
                          disabled={loadingSession === s.id}
                          whileHover={{ x: 2 }}
                          className="group w-full flex items-center gap-2.5 rounded-xl border border-border bg-card/60 backdrop-blur px-3 py-2.5 text-left hover:border-primary/30 hover:bg-accent/30 transition-all disabled:opacity-60"
                        >
                          <div className={cn(
                            "h-7 w-7 rounded-lg border flex items-center justify-center shrink-0",
                            s.mode === "classic" ? "bg-primary/8 border-primary/15" : "bg-primary/8 border-primary/15"
                          )}>
                            {s.mode === "classic"
                              ? <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                              : <Database className="h-3.5 w-3.5 text-primary" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{s.label}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground bg-muted/60 rounded px-1 py-0.5">{s.dialect}</span>
                              {s.mode === "classic" && (
                                <span className="text-[9px] uppercase tracking-wide text-primary bg-primary/10 rounded px-1 py-0.5">Classic</span>
                              )}
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
            </motion.div>
          )}
        </div>
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

function ModeCard({
  active, onClick, icon, title, subtitle, accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: "primary" | "amber";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative rounded-2xl border-2 p-4 text-left transition-all overflow-hidden",
        active
          ? "border-primary bg-primary/8 shadow-lg shadow-primary/10"
          : "border-border bg-card/60 hover:border-primary/40 hover:bg-accent/30"
      )}
    >
      {active && (
        <motion.div
          layoutId="mode-card-glow"
          className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none"
          transition={{ duration: 0.3 }}
        />
      )}
      <div className="relative flex items-start gap-3">
        <div className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10"
        )}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm font-semibold flex items-center gap-1.5", active ? "text-primary" : "text-foreground")}>
            {title}
            {active && <Check className="h-3.5 w-3.5" />}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-0.5">{subtitle}</div>
        </div>
      </div>
    </button>
  );
}

function FeaturePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card/40 px-2.5 py-2 text-[11px] text-muted-foreground">
      <span className="text-primary shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}
