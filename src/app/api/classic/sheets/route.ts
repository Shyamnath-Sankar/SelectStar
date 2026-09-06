/**
 * POST /api/classic/sheets
 *
 * Import a Google Sheet by URL. The user pastes a Google Sheets share URL
 * (e.g. https://docs.google.com/spreadsheets/d/<ID>/edit) and we convert it
 * to the CSV export URL, fetch the CSV, parse it, and register the dataset
 * — same way /api/classic/upload does.
 *
 * The sheet must be shared as "Anyone with the link can view" OR published
 * to the web. If the user pastes a publish-to-web CSV URL directly
 * (e.g. https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv)
 * we use it as-is.
 *
 * Returns the same JSON shape as /api/classic/upload so the frontend's
 * connect() call works without changes.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registerClassicDataset, getClassicConnection } from "@/lib/classic-registry";
import { parseBuffer } from "@/lib/classic-parser";
import { suggestStarterQuestions } from "@/lib/agents/schema-utils";
import { getStarterQuestions } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Convert any Google Sheets URL to a CSV export URL.
 * Returns null if the URL doesn't look like a Google Sheets URL.
 */
function toCsvExportUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const href = url.href;

  // Already an export CSV URL → use as-is (preserve gid if present).
  if (/docs\.google\.com\/spreadsheets\/d\/[^/]+\/export\?format=csv/i.test(href)) {
    // Make sure gid is preserved if it's in the original URL's hash fragment.
    const hashGid = url.hash.match(/gid=([^&]+)/);
    if (hashGid && !url.searchParams.has("gid")) {
      url.searchParams.set("gid", hashGid[1]);
    }
    return url.toString();
  }

  // Publish-to-web CSV URL → use as-is.
  if (/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+\/pub\?output=csv/i.test(href)) {
    return url.toString();
  }
  if (/docs\.google\.com\/spreadsheets\/d\/[^/]+\/pub\?output=csv/i.test(href)) {
    return url.toString();
  }

  // Plain share URL: https://docs.google.com/spreadsheets/d/<ID>/edit[#gid=<GID>]
  const match = href.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)\/edit/i);
  if (match) {
    const sheetId = match[1];
    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
    exportUrl.searchParams.set("format", "csv");
    // Capture gid from query (?gid=) or hash (#gid=) if present.
    const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=([^&]+)/)?.[1];
    if (gid) exportUrl.searchParams.set("gid", gid);
    return exportUrl.toString();
  }

  return null;
}

async function fetchWithTimeout(input: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, {
      signal: controller.signal,
      // Google Sheets sometimes blocks the default fetch user-agent.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SelectStar/1.0; +https://selectstar.example)",
        Accept: "text/csv,application/csv,*/*",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handleSheetImport(req);
  } catch (e) {
    console.error("[classic/sheets] unhandled error:", e);
    return NextResponse.json(
      { error: `Sheet import failed: ${(e as Error).message || String(e)}` },
      { status: 500 }
    );
  }
}

async function handleSheetImport(req: NextRequest) {
  let body: { sheetUrl?: string };
  try {
    body = (await req.json()) as { sheetUrl?: string };
  } catch {
    return NextResponse.json({ error: "Expected JSON body { sheetUrl }." }, { status: 400 });
  }

  const rawUrl = (body.sheetUrl || "").trim();
  if (!rawUrl) {
    return NextResponse.json({ error: "A sheetUrl is required." }, { status: 400 });
  }

  const csvUrl = toCsvExportUrl(rawUrl);
  if (!csvUrl) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Google Sheets URL. Paste a URL like https://docs.google.com/spreadsheets/d/<ID>/edit — and make sure the sheet is shared as 'Anyone with the link can view' or published to the web.",
      },
      { status: 400 }
    );
  }

  // Fetch the CSV.
  let res: Response;
  try {
    res = await fetchWithTimeout(csvUrl);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (/abort/i.test(msg)) {
      return NextResponse.json(
        { error: `Timed out fetching the sheet after ${FETCH_TIMEOUT_MS / 1000}s. The sheet may be too large or Google may be slow right now.` },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Couldn't fetch the sheet: ${msg}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    // 401/403 means the sheet isn't shared publicly.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return NextResponse.json(
        {
          error:
            `Google returned ${res.status}. Make sure the sheet is shared as 'Anyone with the link can view' (Share button → General access) or published to the web (File → Share → Publish to web → CSV).`,
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: `Google returned ${res.status} ${res.statusText}.` },
      { status: 502 }
    );
  }

  // Read the body, with a size cap.
  const contentLength = res.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
    return NextResponse.json(
      { error: `The sheet is too large (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }

  let buf: Buffer;
  try {
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't read the sheet response: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  if (buf.length === 0) {
    return NextResponse.json(
      { error: "The sheet response was empty. Check that the sheet has data and is shared publicly." },
      { status: 400 }
    );
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `The sheet is too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }

  // Detect HTML error pages (Google sometimes returns a login page instead of CSV).
  const looksLikeHtml = /<html|<!doctype html|<head/i.test(buf.slice(0, 500).toString("utf8"));
  if (looksLikeHtml) {
    return NextResponse.json(
      {
        error:
          "Google returned an HTML page instead of CSV. The sheet is probably not shared publicly. Open the sheet → Share → 'Anyone with the link can view', then try again.",
      },
      { status: 403 }
    );
  }

  // Parse the CSV. Use a fake filename so the table gets a sensible name.
  // Google Sheets URLs don't expose the sheet name in the URL, so we use
  // "google_sheet" as the base name. The user can rename columns/tables in
  // the spreadsheet grid later.
  const filename = "google_sheet.csv";
  let parsed;
  try {
    parsed = parseBuffer(buf, filename);
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't parse the sheet: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  if (!parsed.tables.length) {
    return NextResponse.json(
      { error: "The sheet has no readable data." },
      { status: 400 }
    );
  }

  // Create the session row first so we have an id.
  let session;
  try {
    session = await db.session.create({
      data: {
        label: "Google Sheet workspace",
        mode: "classic",
        dialect: "csv",
        connectionString: csvUrl, // store the CSV URL so the session can be re-hydrated later
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

  // Register all parsed tables (CSV → 1 table; we use the first one).
  const firstTable = parsed.tables[0];
  let schema;
  try {
    schema = registerClassicDataset(session.id, firstTable);
  } catch (e) {
    console.error("[classic/sheets] registerClassicDataset failed:", e);
    return NextResponse.json(
      { error: `Couldn't register dataset: ${(e as Error).message}` },
      { status: 500 }
    );
  }
  const conn = getClassicConnection(session.id);
  if (!conn) {
    console.error("[classic/sheets] getClassicConnection returned undefined after registerClassicDataset");
    return NextResponse.json(
      { error: "Failed to initialize the in-memory workspace. Please try again." },
      { status: 500 }
    );
  }
  // Add any additional sheets (rare for CSV, but supported).
  for (let i = 1; i < parsed.tables.length; i++) {
    conn.addTable(parsed.tables[i]);
  }
  const finalSchema = conn.buildSchemaSnapshot();

  // Update the session with the real schema + a friendly label.
  try {
    await db.session.update({
      where: { id: session.id },
      data: {
        schemaSnapshot: JSON.stringify(finalSchema),
        label: `${firstTable.name} (${firstTable.rows.length.toLocaleString()} rows)`,
      },
    });
  } catch (e) {
    console.warn("[classic/sheets] couldn't persist schema snapshot:", (e as Error).message);
  }

  const { questions: suggestedQuestions, domain } = getStarterQuestions(finalSchema, suggestStarterQuestions);

  return NextResponse.json({
    sessionId: session.id,
    mode: "classic",
    dialect: "csv",
    label: `${firstTable.name} (${firstTable.rows.length.toLocaleString()} rows)`,
    schema: finalSchema,
    canWrite: true,
    suggestedQuestions,
    ...(domain ? { domain: domain.id } : {}),
  });
}
