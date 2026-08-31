/**
 * POST /api/refresh-schema
 *
 * Re-runs the introspection pass for a session and updates the cached
 * SchemaSnapshot (spec §4.4 — refresh on explicit request or after a DDL
 * statement in Zen mode).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getConnection } from "@/lib/db-connection";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json().catch(() => ({}));
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const conn = getConnection(sessionId);
  if (!conn) return NextResponse.json({ error: "No active connection. Reconnect first." }, { status: 400 });

  try {
    const schema = await conn.introspect();
    const canWrite = await conn.detectCanWrite();
    await db.session.update({
      where: { id: sessionId },
      data: {
        schemaSnapshot: JSON.stringify(schema),
        canWrite,
        status: "connected",
        errorMessage: null,
      },
    });
    return NextResponse.json({
      schema,
      canWrite,
      suggestedQuestions: suggestStarterQuestions(schema),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
