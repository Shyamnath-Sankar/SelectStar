"use client";

import type { CanvasObject } from "@/lib/types";
import { CanvasTable } from "./canvas-table";
import { CanvasChart } from "./canvas-chart";
import { CanvasSql } from "./canvas-sql";
import { CanvasEda } from "./canvas-eda";
import { CanvasModel } from "./canvas-model";
import { CanvasPendingWrite } from "./canvas-pending-write";
import { CanvasError } from "./canvas-error";

export function CanvasObjectView({ obj }: { obj: CanvasObject }) {
  switch (obj.type) {
    case "table":
      return <CanvasTable obj={obj} />;
    case "chart":
      return <CanvasChart obj={obj} />;
    case "sql":
      return <CanvasSql obj={obj} />;
    case "eda_summary":
      return <CanvasEda obj={obj} />;
    case "model_result":
      return <CanvasModel obj={obj} />;
    case "pending_write":
      return <CanvasPendingWrite obj={obj} />;
    case "error":
      return <CanvasError obj={obj} />;
  }
}
