/**
 * /api/sessions/[id]
 *
 * GET    — full session state: schema, messages, canvas history, audit logs.
 * PATCH  — toggle zenMode (off→on requires canWrite).
 * DELETE — close the connection and delete the session + its data.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadSessionState, closeSession, loadCanvasHistory, listAuditLogs } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = await loadSessionState(id);
  if (!state) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  const canvas = await loadCanvasHistory(id);
  const audit = await listAuditLogs(id);
  return NextResponse.json({ ...state, canvas, audit });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const patch: { zenMode?: boolean; label?: string } = {};
  if (typeof body.zenMode === "boolean") {
    if (body.zenMode && !session.canWrite) {
      return NextResponse.json(
        { error: "Zen mode requires write privileges, which this connection doesn't have." },
        { status: 400 }
      );
    }
    patch.zenMode = body.zenMode;
  }
  if (typeof body.label === "string") patch.label = body.label;

  const updated = await db.session.update({ where: { id }, data: patch, select: { id: true, zenMode: true, label: true, canWrite: true } });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  closeSession(id);
  await db.session.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
