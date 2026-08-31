/**
 * POST /api/data-quality/scan
 *
 * Runs an automatic background data-quality scan on the connected
 * database. Returns a `DataQualityCanvasObject`-shaped payload the
 * client adds to the canvas.
 *
 * This is fire-and-forget from the client's perspective — it's called
 * once after a successful connect and the result is rendered as a
 * canvas card + a non-blocking toast.
 */
import { NextRequest, NextResponse } from "next/server";
import { loadSessionState, saveCanvasObject } from "@/lib/session";
import { runDataQualityScan, toCanvasObject } from "@/lib/agents/data-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = (await req.json()) as { sessionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const sessionId = body.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const sessionState = await loadSessionState(sessionId);
  if (!sessionState) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (!sessionState.schemaSnapshot) {
    return NextResponse.json({ error: "No schema available — connect first." }, { status: 400 });
  }

  try {
    const result = await runDataQualityScan(sessionId, sessionState.schemaSnapshot);
    const canvasObj = toCanvasObject(result);
    // Persist as turn 0 (pre-conversation) so it appears above everything else.
    await saveCanvasObject(sessionId, 0, 0, canvasObj);
    return NextResponse.json({ ...canvasObj, scannedTables: result.scannedTables, durationMs: result.durationMs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Scan failed." }, { status: 500 });
  }
}
