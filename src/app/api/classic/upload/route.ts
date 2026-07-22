/**
 * POST /api/classic/upload
 *
 * Accepts multipart/form-data with one or more "files" fields (.csv or .xlsx).
 * Each file is parsed (XLSX files produce one table per sheet), and all
 * tables are registered in the same in-memory SQLite workspace under a
 * fresh sessionId. The agent can then JOIN across tables from different files.
 *
 * The connectionString stored on the Session row uses the "classic-multi://"
 * scheme with a JSON array of file paths, so the session can be re-hydrated
 * after a server restart (see reopenClassicFromDisk).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { registerClassicDataset, getClassicConnection } from "@/lib/classic-registry";
import { parseBuffer } from "@/lib/classic-parser";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOAD_DIR = process.env.CLASSIC_UPLOAD_DIR
  || path.join(process.cwd(), "db", "classic-uploads");
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".xlsb", ".ods"]);

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  // Collect ALL files under any field name (file, files, etc.).
  const files: File[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) files.push(value);
  }
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded — attach one or more files." }, { status: 400 });
  }

  // Validate all files first.
  for (const file of files) {
    const ext = path.extname(file.name.toLowerCase());
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type "${ext}" for "${file.name}". Allowed: ${[...ALLOWED_EXT].join(", ")}.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
        { status: 413 }
      );
    }
  }

  // Create the session row first so we have an id.
  const dialect = files.some((f) => /\.(xlsx|xlsm|xlsb|ods)$/i.test(f.name.toLowerCase())) ? "xlsx" : "csv";
  const label = files.length === 1
    ? `${files[0].name.replace(/\.[^.]+$/, "")} workspace`
    : `${files.length}-file workspace`;

  let session;
  try {
    session = await db.session.create({
      data: {
        label,
        mode: "classic",
        dialect,
        connectionString: "classic-multi://[]", // placeholder, updated after files are persisted
        canWrite: true,
        status: "connected",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to create session: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // Process each file: persist to disk, parse, register tables.
  const diskPaths: string[] = [];
  const allTables: { name: string; columns: { name: string; dtype?: string }[]; rows: Record<string, unknown>[] }[] = [];
  const totalRows = { count: 0 };

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't create upload directory: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  for (const file of files) {
    let buf: Buffer;
    try {
      buf = Buffer.from(await file.arrayBuffer());
    } catch (e) {
      return NextResponse.json({ error: `Couldn't read ${file.name}: ${(e as Error).message}` }, { status: 400 });
    }

    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    const diskPath = path.join(UPLOAD_DIR, unique);
    try {
      await fs.writeFile(diskPath, buf);
      diskPaths.push(diskPath);
    } catch (e) {
      return NextResponse.json(
        { error: `Couldn't persist ${file.name}: ${(e as Error).message}` },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = parseBuffer(buf, file.name);
    } catch (e) {
      return NextResponse.json(
        { error: `Couldn't parse ${file.name}: ${(e as Error).message}` },
        { status: 400 }
      );
    }
    for (const table of parsed.tables) {
      allTables.push(table);
      totalRows.count += table.rows.length;
    }
  }

  if (!allTables.length) {
    return NextResponse.json({ error: "No tables could be parsed from the uploaded files." }, { status: 400 });
  }

  // Register the first table to create the connection, then add the rest.
  const firstTable = allTables[0];
  const schema = registerClassicDataset(session.id, firstTable, diskPaths[0]);
  const conn = getClassicConnection(session.id)!;
  for (let i = 1; i < allTables.length; i++) {
    conn.addTable(allTables[i], diskPaths[Math.min(i, diskPaths.length - 1)]);
  }
  const finalSchema = conn.buildSchemaSnapshot();

  // Update the session row with the real connectionString + schema.
  const connStr = `classic-multi://${JSON.stringify(diskPaths)}`;
  try {
    await db.session.update({
      where: { id: session.id },
      data: {
        connectionString: connStr,
        schemaSnapshot: JSON.stringify(finalSchema),
        label: allTables.length === 1
          ? `${allTables[0].name} (${allTables[0].rows.length.toLocaleString()} rows)`
          : `${allTables.length} tables · ${totalRows.count.toLocaleString()} rows`,
      },
    });
  } catch (e) {
    console.warn("[classic/upload] couldn't persist schema snapshot:", (e as Error).message);
  }

  const suggestedQuestions = suggestStarterQuestions(finalSchema);

  return NextResponse.json({
    sessionId: session.id,
    mode: "classic",
    dialect,
    label: allTables.length === 1
      ? `${allTables[0].name} (${allTables[0].rows.length.toLocaleString()} rows)`
      : `${allTables.length} tables · ${totalRows.count.toLocaleString()} rows`,
    schema: finalSchema,
    canWrite: true,
    suggestedQuestions,
    tables: finalSchema.tables.map((t) => ({
      name: t.name,
      rowCount: t.rowCount,
      columns: t.columns.map((c) => c.name),
    })),
  });
}
