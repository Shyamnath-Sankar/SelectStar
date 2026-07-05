"use client";

import { useEffect, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { Database, Shield, ShieldAlert, RefreshCw, ListTree, Loader2, ScrollText, MessageSquare, LayoutDashboard } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPane } from "@/components/chat-pane";
import { CanvasPane } from "@/components/canvas-pane";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AppShell() {
  const { sessionId, schema, canWrite, zenMode, setZenMode, dialect } = useSession();
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"chat" | "canvas">("chat");
  const canvasCount = useSession((s) => s.canvas.length);

  async function toggleZen(checked: boolean) {
    if (!sessionId) return;
    if (checked && !canWrite) {
      toast.error("This connection doesn't have write privileges, so Zen mode isn't available.");
      return;
    }
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zenMode: checked }),
    });
    if (res.ok) {
      setZenMode(checked);
      toast.success(checked ? "Zen mode on — writes allowed with confirmation." : "Zen mode off — back to read-only.");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't toggle Zen mode.");
    }
  }

  async function refreshSchema() {
    if (!sessionId) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      useSession.setState({ schema: data.schema, canWrite: data.canWrite, suggestedQuestions: data.suggestedQuestions });
      toast.success("Schema refreshed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 h-12 px-3 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-2 min-w-0">
          <Logo className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm leading-none">SelectStar</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1 uppercase tracking-wide">{dialect}</Badge>
            </div>
          </div>
          {/* Connection status dot */}
          <div className="flex items-center gap-1 ml-1" title="Connected">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Zen mode toggle */}
        <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 h-8">
          {zenMode ? (
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <Shield className="h-3.5 w-3.5 text-emerald-500" />
          )}
          <span className="text-xs font-medium">Zen</span>
          <Switch
            checked={zenMode}
            onCheckedChange={toggleZen}
            disabled={!canWrite}
            className="scale-90"
            aria-label="Toggle Zen mode"
          />
        </div>
        {canWrite && !zenMode && (
          <span className="hidden sm:inline text-[10px] text-muted-foreground -ml-1">writes blocked</span>
        )}
        {!canWrite && (
          <Badge variant="secondary" className="text-[9px] h-5 gap-1">
            <Shield className="h-2.5 w-2.5" /> read-only role
          </Badge>
        )}

        <div className="h-5 w-px bg-border mx-0.5" />

        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setSchemaOpen(true)}>
          <ListTree className="h-3.5 w-3.5" /> Schema
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={refreshSchema} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAuditOpen(true)}>
          <ScrollText className="h-3.5 w-3.5" /> Audit
        </Button>
        <ThemeToggle />
      </header>

      {/* Two-pane resizable layout (desktop) or tabs (mobile) */}
      <div className="flex-1 min-h-0">
        {isMobile ? (
          <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as "chat" | "canvas")} className="h-full flex flex-col">
            <TabsList className="grid grid-cols-2 mx-3 mt-2 shrink-0">
              <TabsTrigger value="chat" className="gap-1.5 text-xs">
                <MessageSquare className="h-3.5 w-3.5" /> Chat
              </TabsTrigger>
              <TabsTrigger value="canvas" className="gap-1.5 text-xs relative">
                <LayoutDashboard className="h-3.5 w-3.5" /> Canvas
                {canvasCount > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-medium tabular-nums">
                    {canvasCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0">
              {mobileTab === "chat" ? <ChatPane /> : <CanvasPane />}
            </div>
          </Tabs>
        ) : (
          <PanelGroup direction="horizontal" autoSaveId="quill-layout">
            <Panel defaultSize={36} minSize={24} maxSize={50}>
              <ChatPane />
            </Panel>
            <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors data-[resize-handle-state=drag]:bg-primary relative group">
              <div className="absolute inset-y-0 -left-1 -right-1" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-1 rounded-full bg-border group-hover:bg-primary/40 transition-colors" />
            </PanelResizeHandle>
            <Panel defaultSize={64} minSize={40}>
              <CanvasPane />
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Schema browser sheet */}
      <Sheet open={schemaOpen} onOpenChange={setSchemaOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ListTree className="h-4 w-4 text-primary" /> Schema
              <span className="text-xs font-normal text-muted-foreground">
                {schema?.tables.length ?? 0} tables
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-1.5">
            {schema?.tables.map((t) => (
              <SchemaTableCard key={t.name} name={t.name} rowCount={t.rowCount} description={t.description} columns={t.columns} />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Audit log sheet */}
      <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" /> Write audit log
            </SheetTitle>
          </SheetHeader>
          <AuditLogList sessionId={sessionId!} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SchemaTableCard({ name, rowCount, description, columns }: {
  name: string;
  rowCount: number;
  description?: string;
  columns: { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; isForeignKey: boolean; references?: { table: string; column: string } | null }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40">
        <Database className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-mono text-xs font-medium">{name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{rowCount.toLocaleString()} rows</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1 bg-muted/20">
          {description && <p className="text-[10px] text-muted-foreground mb-1.5">{description}</p>}
          {columns.map((c) => (
            <div key={c.name} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono">{c.name}</span>
              <span className="text-muted-foreground text-[10px]">{c.dataType}</span>
              <div className="ml-auto flex gap-1">
                {c.isPrimaryKey && <Badge variant="outline" className="h-4 text-[9px] px-1">PK</Badge>}
                {c.isForeignKey && c.references && (
                  <Badge variant="outline" className="h-4 text-[9px] px-1 text-primary">FK→{c.references.table}</Badge>
                )}
                {!c.nullable && <Badge variant="outline" className="h-4 text-[9px] px-1">NN</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AuditLogList({ sessionId }: { sessionId: string }) {
  const [logs, setLogs] = useState<{ id: string; sql: string; status: string; rowsAffected: number; note: string | null; createdAt: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/audit?sessionId=${sessionId}`);
        const data = await res.json();
        if (!cancelled) setLogs(data.logs || []);
      } catch {
        if (!cancelled) setLogs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (logs === null) return <div className="mt-6 text-center text-xs text-muted-foreground">Loading…</div>;
  if (logs.length === 0) {
    return (
      <div className="mt-8 text-center text-xs text-muted-foreground">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No write statements have been executed in this session.
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      {logs.map((l) => (
        <div key={l.id} className="rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={cn("h-4 text-[9px] px-1 uppercase", statusColor(l.status))}>{l.status}</Badge>
            <span className="text-[10px] text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
            {l.rowsAffected > 0 && <span className="text-[10px] text-muted-foreground ml-auto">{l.rowsAffected} rows</span>}
          </div>
          <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 rounded p-2 overflow-x-auto">{l.sql}</pre>
          {l.note && <p className="text-[10px] text-muted-foreground mt-1">{l.note}</p>}
        </div>
      ))}
    </div>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case "executed": return "text-emerald-600 dark:text-emerald-400";
    case "rolled_back": return "text-blue-600 dark:text-blue-400";
    case "failed": return "text-destructive";
    default: return "text-muted-foreground";
  }
}
