/**
 * GET /api/classic/download?sessionId=<id>&format=csv|xlsx&table=<name>
 *
 * Exports a table (or all tables) from the Classic workspace.
 *
 *   format=csv  &table=foo  → single CSV file
 *   format=xlsx &table=foo  → single-sheet XLSX
 *   format=xlsx             (no table=) → multi-sheet XLSX with every table
 *   format=csv              (no table=) → first table only (CSV can't hold multiple tables)
 *
 * Uses SheetJS for both CSV and XLSX output.
 */
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getClassicConnection } from "@/lib/classic-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const format = (url.searchParams.get("format") || "xlsx").toLowerCase() as "csv" | "xlsx";
  const tableName = url.searchParams.get("table");

  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  if (format !== "csv" && format !== "xlsx") {
    return NextResponse.json({ error: `Unsupported format "${format}". Use csv or xlsx.` }, { status: 400 });
  }

  const conn = getClassicConnection(sessionId);
  if (!conn) {
    return NextResponse.json(
      { error: "No Classic dataset found for this session. The server may have restarted — please re-upload the file." },
      { status: 404 }
    );
  }

  const allTables = conn.getAllTables();
  if (!allTables.length) return NextResponse.json({ error: "The workspace is empty." }, { status: 400 });

  // Determine which tables to export.
  const tablesToExport = tableName
    ? allTables.filter((t) => t.name === tableName)
    : allTables;
  if (!tablesToExport.length) {
    return NextResponse.json({ error: `Table "${tableName}" not found.` }, { status: 404 });
  }

  // For CSV with multiple tables, only export the first (CSV can't hold multiple).
  const effectiveTables = format === "csv" ? [tablesToExport[0]] : tablesToExport;

  const wb = XLSX.utils.book_new();
  for (const table of effectiveTables) {
    const { rows } = conn.getRows(table.name);
    const header = table.columns.map((c) => c.name);
    const aoa: unknown[][] = [header, ...rows.map((r) => header.map((h) => r[h] ?? null))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Sheet name: sanitised, max 31 chars (SheetJS / Excel limit).
    const sheetName = table.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 31) || "data";
    // Avoid duplicate sheet names.
    let uniqueSheetName = sheetName;
    let n = 2;
    while (wb.SheetNames.includes(uniqueSheetName)) {
      uniqueSheetName = `${sheetName.slice(0, 28)}_${n++}`;
    }
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: format }) as Buffer;
  const mimeType = format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const filename = `selectstar-classic.${format}`;

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
