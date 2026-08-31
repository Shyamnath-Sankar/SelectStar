/**
 * /api/classic/data — direct cell-edit API for the spreadsheet grid.
 *
 *   GET    ?sessionId=X[&table=Y][&limit=N][&offset=M]
 *          → reads rows from table Y (defaults to the first table)
 *
 *   POST   { sessionId, table, op: "setCell", rowIndex, column, value }
 *          { sessionId, table, op: "addRow", row? }
 *          { sessionId, table, op: "deleteRow", rowIndex }
 *          { sessionId, table, op: "renameColumn", oldName, newName }
 *          { sessionId, table, op: "addColumn", name, dtype? }
 *          { sessionId, table, op: "deleteColumn", name }
 *
 * SQL queries issued by the chat agent see edits live — the spreadsheet and
 * the in-memory SQLite tables are the same object.
 */
import { NextRequest, NextResponse } from "next/server";
import { getClassicConnection } from "@/lib/classic-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const tableName = url.searchParams.get("table");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const conn = getClassicConnection(sessionId);
  if (!conn) {
    return NextResponse.json(
      { error: "No Classic dataset found for this session. The server may have restarted — please re-upload the file." },
      { status: 404 }
    );
  }

  // If no table specified, return the list of tables + their profiles.
  if (!tableName) {
    const tables = conn.getAllTables().map((t) => ({
      name: t.name,
      columns: t.columns,
      rowCount: t.rows.length,
      sourceFile: t.sourceFile,
      profile: t.profile,
    }));
    return NextResponse.json({ tables });
  }

  const limit = Math.min(2000, parseInt(url.searchParams.get("limit") || "1000", 10));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
  const { columns, rows } = conn.getRows(tableName);
  if (!columns.length) {
    return NextResponse.json({ error: `Table "${tableName}" not found.` }, { status: 404 });
  }
  return NextResponse.json({
    columns,
    rows: rows.slice(offset, offset + limit),
    totalRows: rows.length,
    offset,
    limit,
    table: tableName,
  });
}

type EditOp =
  | { op: "setCell"; rowIndex: number; column: string; value: unknown }
  | { op: "addRow"; row?: Record<string, unknown> }
  | { op: "deleteRow"; rowIndex: number }
  | { op: "renameColumn"; oldName: string; newName: string }
  | { op: "addColumn"; name: string; dtype?: string }
  | { op: "deleteColumn"; name: string };

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; table?: string } & Partial<EditOp>;
  try {
    body = (await req.json()) as { sessionId?: string; table?: string } & Partial<EditOp>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { sessionId, table, op } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  if (!table) return NextResponse.json({ error: "table is required." }, { status: 400 });
  if (!op) return NextResponse.json({ error: "op is required." }, { status: 400 });

  const conn = getClassicConnection(sessionId);
  if (!conn) {
    return NextResponse.json(
      { error: "No Classic dataset found for this session. The server may have restarted — please re-upload the file." },
      { status: 404 }
    );
  }

  try {
    switch (op) {
      case "setCell": {
        const { rowIndex, column, value } = body as Extract<EditOp, { op: "setCell" }>;
        if (typeof rowIndex !== "number" || !column) {
          return NextResponse.json({ error: "setCell requires rowIndex (number) and column (string)." }, { status: 400 });
        }
        const totalRows = conn.setCell(table, rowIndex, column, value);
        return NextResponse.json({ ok: true, op, table, totalRows });
      }
      case "addRow": {
        const { row } = body as Extract<EditOp, { op: "addRow" }>;
        const result = conn.addRow(table, row);
        return NextResponse.json({ ok: true, op, table, ...result });
      }
      case "deleteRow": {
        const { rowIndex } = body as Extract<EditOp, { op: "deleteRow" }>;
        if (typeof rowIndex !== "number") {
          return NextResponse.json({ error: "deleteRow requires rowIndex (number)." }, { status: 400 });
        }
        const totalRows = conn.deleteRow(table, rowIndex);
        return NextResponse.json({ ok: true, op, table, totalRows });
      }
      case "renameColumn": {
        const { oldName, newName } = body as Extract<EditOp, { op: "renameColumn" }>;
        if (!oldName || !newName) {
          return NextResponse.json({ error: "renameColumn requires oldName and newName." }, { status: 400 });
        }
        conn.renameColumn(table, oldName, newName);
        return NextResponse.json({ ok: true, op, table });
      }
      case "addColumn": {
        const { name, dtype } = body as Extract<EditOp, { op: "addColumn" }>;
        if (!name) return NextResponse.json({ error: "addColumn requires name." }, { status: 400 });
        conn.addColumn(table, name, dtype);
        return NextResponse.json({ ok: true, op, table });
      }
      case "deleteColumn": {
        const { name } = body as Extract<EditOp, { op: "deleteColumn" }>;
        if (!name) return NextResponse.json({ error: "deleteColumn requires name." }, { status: 400 });
        conn.deleteColumn(table, name);
        return NextResponse.json({ ok: true, op, table });
      }
      default:
        return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
