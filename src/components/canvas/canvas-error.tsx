"use client";

import { AlertTriangle } from "lucide-react";
import type { ErrorCanvasObject } from "@/lib/types";

export function CanvasError({ obj }: { obj: ErrorCanvasObject }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="font-medium text-sm text-destructive">{obj.title || "Error"}</span>
      </div>
      <p className="text-sm text-muted-foreground">{obj.message}</p>
    </div>
  );
}
