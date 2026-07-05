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
  let session;
  try {
    session = await db.session.create({
      data: {
        label,
        dialect: parsed.dialect,
        connectionString: connStr,
        status: "connecting",
      },
    });
  } catch (e) {
    console.error("Failed to create session in app database:", e);
    return NextResponse.json(
      { error: `Failed to initialize session database entry. Database might not be fully migrated. Details: ${(e as Error).message}` },
      { status: 500 }
    );
  }


  // ---- Phase 1: open + ping the connection (driver-level: DNS, auth, TLS) ----
  let conn;
  try {
    conn = await openConnection(session.id, connStr);
    // pg's Pool is lazy — ping forces a real round-trip so DNS/auth/TLS/port
    // errors surface HERE, distinct from SQL/introspection errors below.
    await conn.ping();
  } catch (e) {
    const message = friendlyConnectionError(e as Error, parsed.dialect);
    await db.session.update({
      where: { id: session.id },
      data: { status: "error", errorMessage: message },
    });
    return NextResponse.json({ error: message, sessionId: session.id }, { status: 502 });
  }

  // ---- Phase 2: introspect + detect privileges (SQL-level) ----
  // The connection succeeded, so any failure here is a schema-read problem,
  // NOT a connection problem — surface the real SQL error directly.
  let schema;
  try {
    schema = await conn.introspect();
  } catch (e) {
    const raw = (e as Error).message || String(e);
    const message = `Connected to the database, but couldn't read its schema: ${raw}. The account may lack permission to query information_schema, or the database may be an older version with different system views.`;
    await db.session.update({
      where: { id: session.id },
      data: { status: "error", errorMessage: message },
    });
    return NextResponse.json({ error: message, sessionId: session.id }, { status: 502 });
  }

  let canWrite = false;
  try {
    canWrite = await conn.detectCanWrite();
  } catch {
    canWrite = false; // non-fatal — just disable Zen mode
  }

  try {
    await db.session.update({
      where: { id: session.id },
      data: {
        status: "connected",
        canWrite,
        schemaSnapshot: JSON.stringify(schema),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Connected, but couldn't save the session: ${(e as Error).message}` }, { status: 500 });
  }

  const suggestedQuestions = suggestStarterQuestions(schema);

  const response: ConnectResponse = {
    sessionId: session.id,
    dialect: parsed.dialect,
    schema,
    canWrite,
    suggestedQuestions,
  };
  return NextResponse.json(response);
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
