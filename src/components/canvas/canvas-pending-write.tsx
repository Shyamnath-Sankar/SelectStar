"use client";

import { useState } from "react";
import { ShieldAlert, Check, Undo2, X, Loader2, ShieldCheck } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import type { PendingWriteCanvasObject } from "@/lib/types";
import { useSession } from "@/lib/store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CanvasPendingWrite({ obj }: { obj: PendingWriteCanvasObject }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const resolvePendingWrite = useSession((s) => s.resolvePendingWrite);
  const [busy, setBusy] = useState<null | "confirm" | "rollback" | "cancel">(null);

  const status = obj.status ?? "pending";
  const resolved = status !== "pending";

  async function act(action: "confirm" | "rollback" | "cancel") {
    setBusy(action);
    try {
      const res = await fetch("/api/confirm-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId: obj.pendingId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Action failed");
        resolvePendingWrite(obj.pendingId, "failed", undefined, data.error);
      } else {
        resolvePendingWrite(obj.pendingId, data.status, data.rowsAffected);
        if (data.status === "executed") toast.success(`Write executed — ${data.rowsAffected} rows affected.`);
        else if (data.status === "rolled_back") toast.info(`Dry-run complete — ${data.rowsAffected} rows would have been affected. Rolled back.`);
        else toast.info("Pending write cancelled.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("rounded-xl border-2 overflow-hidden", resolved ? "border-border bg-card" : "border-amber-500/40 bg-amber-500/5")}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
        {resolved ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <ShieldAlert className="h-4 w-4 text-amber-500" />}
        <span className="font-medium text-sm">Pending write — review required</span>
        <span className={cn("ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded", statusBadgeClass(status))}>
          {status.replace("_", " ")}
        </span>
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground">
        <span className="text-amber-600 dark:text-amber-400 font-medium">Estimated impact:</span> {obj.estimatedImpact}
      </div>

      <SyntaxHighlighter
        language="sql"
        style={isDark ? oneDark : oneLight}
        customStyle={{ margin: 0, background: "transparent", padding: "0.75rem 1rem", fontSize: "0.8125rem" }}
        wrapLongLines
      >
        {obj.query}
      </SyntaxHighlighter>

      {!resolved && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-border/60 bg-amber-500/5">
          <Button size="sm" onClick={() => act("confirm")} disabled={!!busy} className="gap-1.5">
            {busy === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirm & execute
          </Button>
          <Button size="sm" variant="outline" onClick={() => act("rollback")} disabled={!!busy} className="gap-1.5">
            {busy === "rollback" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            Dry-run (rollback)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act("cancel")} disabled={!!busy} className="gap-1.5 ml-auto">
            {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Cancel
          </Button>
        </div>
      )}

      {resolved && obj.rowsAffected !== undefined && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border/60">
          {status === "executed" && `✓ Committed — ${obj.rowsAffected} rows affected.`}
          {status === "rolled_back" && `↺ Rolled back — ${obj.rowsAffected} rows would have been affected.`}
          {status === "cancelled" && `Discarded without execution.`}
          {status === "failed" && `✗ Failed: ${obj.error}`}
        </div>
      )}
    </div>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
    case "executed": return "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400";
    case "rolled_back": return "bg-blue-500/20 text-blue-600 dark:text-blue-400";
    case "cancelled": return "bg-muted text-muted-foreground";
    case "failed": return "bg-destructive/20 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}
