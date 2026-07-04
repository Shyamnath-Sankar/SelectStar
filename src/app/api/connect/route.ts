/**
 * POST /api/connect
 *
 * Parses a connection string, opens the database, introspects the schema,
 * detects write privileges, and creates a Session row. Returns the schema,
 * write capability, and suggested starter questions (spec §4, §8).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openConnection, parseConnectionString } from "@/lib/db-connection";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";
import type { ConnectRequest, ConnectResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: ConnectRequest;
  try {
    body = (await req.json()) as ConnectRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const connStr = (body.connectionString || "").trim();
  if (!connStr) {
    return NextResponse.json({ error: "A connection string is required." }, { status: 400 });
  }

  // Parse first so we surface a clean error before opening anything.
  let parsed;
  try {
    parsed = parseConnectionString(connStr);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const label = body.label?.trim() || defaultLabel(connStr, parsed.dialect);

  // Create the session row first so we have an id for the connection registry.
  const session = await db.session.create({
    data: {
      label,
      dialect: parsed.dialect,
      connectionString: connStr,
      status: "connecting",
    },
  });

  try {
    const conn = await openConnection(session.id, connStr);
    const schema = await conn.introspect();
    const canWrite = await conn.detectCanWrite();

    await db.session.update({
      where: { id: session.id },
      data: {
        status: "connected",
        canWrite,
        schemaSnapshot: JSON.stringify(schema),
      },
    });

    const suggestedQuestions = suggestStarterQuestions(schema);

    const response: ConnectResponse = {
      sessionId: session.id,
      dialect: parsed.dialect,
      schema,
      canWrite,
      suggestedQuestions,
    };
    return NextResponse.json(response);
  } catch (e) {
    const message = friendlyConnectionError(e as Error, parsed.dialect);
    await db.session.update({
      where: { id: session.id },
      data: { status: "error", errorMessage: message },
    });
    return NextResponse.json({ error: message, sessionId: session.id }, { status: 502 });
  }
}

function defaultLabel(connStr: string, dialect: string): string {
  if (connStr.trim().toLowerCase() === "demo") return "Demo E-commerce DB";
  if (dialect === "sqlite") return `SQLite · ${connStr.replace(/^sqlite:/i, "")}`;
  try {
    const u = new URL(connStr);
    return `${dialect} · ${u.host || "remote"}/${(u.pathname || "/").slice(1) || "?"}`;
  } catch {
    return `${dialect} session`;
  }
}

function friendlyConnectionError(e: Error, dialect: string): string {
  const m = e.message || String(e);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return `Could not reach the database host. ${m}`;
  if (/ECONNREFUSED|ECONNRESET/i.test(m)) return `The database refused the connection. ${m}`;
  if (/authentication|password|login|role .* does not exist/i.test(m)) return `Authentication failed — check your credentials. ${m}`;
  if (/ssl|tls|certificate/i.test(m)) return `SSL/TLS issue connecting to ${dialect}: ${m}`;
  if (/does not exist|no such file|fileMustExist/i.test(m)) return `The database file or database does not exist. ${m}`;
  return `Could not connect to the database: ${m}`;
}
