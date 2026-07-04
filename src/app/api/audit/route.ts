/**
 * GET /api/audit?sessionId=...
 * Returns the audit trail of executed write statements for a session (spec §6.5).
 */
import { NextRequest, NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  const logs = await listAuditLogs(sessionId);
  return NextResponse.json({ logs });
}
