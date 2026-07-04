"use client";

import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, Sparkles } from "lucide-react";
import { useSession } from "@/lib/store";
import { CanvasObjectView } from "@/components/canvas/canvas-object";

export function CanvasPane() {
  const canvas = useSession((s) => s.canvas);

  return (
    <div className="flex flex-col h-full bg-muted/20">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border bg-background shrink-0">
        <LayoutDashboard className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">Canvas</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">{canvas.length} {canvas.length === 1 ? "artifact" : "artifacts"}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        <AnimatePresence initial={false}>
          {canvas.length === 0 ? (
            <EmptyCanvas key="empty" />
          ) : (
            canvas.map((obj, i) => (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="animate-canvas-in"
              >
                <CanvasObjectView obj={obj} />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-16">
      <div className="h-12 w-12 rounded-2xl bg-muted border border-border flex items-center justify-center mb-3">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm text-muted-foreground">Your canvas is empty</h3>
      <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
        Tables, charts, SQL, statistical summaries and model results from your
        conversation will appear here — like a living notebook.
      </p>
    </div>
  );
}
