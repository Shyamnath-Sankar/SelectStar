/**
 * Session management routes.
 *
 * GET  /api/sessions          — list recent sessions (for a session picker).
 * GET  /api/sessions/:id      — load a session (state + history + canvas).
 * PATCH /api/sessions/:id     — update session (e.g. toggle zenMode).
 * DELETE /api/sessions/:id    — close + delete a session.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadSessionState, closeSession, loadCanvasHistory } from "@/lib/session";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await db.session.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true, label: true, dialect: true, status: true,
      canWrite: true, zenMode: true, createdAt: true, updatedAt: true,
    },
  });
  return NextResponse.json({ sessions });
}
