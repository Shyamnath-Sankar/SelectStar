/**
 * GET /api/suggest?sessionId=...
 * Returns suggested starter questions for a session's schema (spec §8).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";
import type { SchemaSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session?.schemaSnapshot) return NextResponse.json({ questions: [] });
  let schema: SchemaSnapshot;
  try { schema = JSON.parse(session.schemaSnapshot) as SchemaSnapshot; } catch { return NextResponse.json({ questions: [] }); }
  return NextResponse.json({ questions: suggestStarterQuestions(schema) });
}
