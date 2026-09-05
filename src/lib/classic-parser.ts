/**
 * Classic file parser — reads CSV / XLSX files into in-memory rows.
 *
 * For XLSX files, parses EVERY sheet (each becomes a separate table in the
 * workspace, named after the sheet). For CSV, returns a single table.
 */
import * as XLSX from "xlsx";
import { promises as fs } from "fs";

export interface ParsedFile {
  /** Multiple tables — one per XLSX sheet, or just one for CSV. */
  tables: {
    name: string;
    columns: { name: string; dtype?: string }[];
    rows: Record<string, unknown>[];
  }[];
}

export async function parseFile(
  filePath: string,
  _tableName?: string
): Promise<ParsedFile> {
  const buf = await fs.readFile(filePath);
  return parseBuffer(buf, filePath);
}

export function parseBuffer(
  buf: Buffer,
  filename: string
): ParsedFile {
  const lower = filename.toLowerCase();
  const wb = XLSX.read(buf, { type: "buffer" });
  if (!wb.SheetNames.length) throw new Error("The uploaded workbook has no sheets.");

  const baseName = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") || "data";
  const tables: ParsedFile["tables"] = [];

  // For CSV/TSV/TXT files, wb has exactly one sheet — use the filename as
  // the table name. For XLSX, use each sheet name (sanitised).
  const isCsvLike = /\.(csv|tsv|txt)$/i.test(lower);
  const sheetNamesToUse = isCsvLike
    ? [wb.SheetNames[0]]
    : wb.SheetNames;

  for (const sheetName of sheetNamesToUse) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      // Use raw:false so date-looking cells come back as formatted strings
      // (e.g. "2024-01-15" or "1/15/2024") instead of Excel serial numbers.
      // This keeps dtype inference + SQL WHERE clauses working on dates.
      raw: false,
      defval: null,
      blankrows: false,
    });
    if (!aoa.length) continue;

    const headerRow = (aoa[0] as unknown[]).map((h, i) =>
      h === null || h === undefined || h === "" ? `column_${i + 1}` : String(h).trim()
    );
    // Dedup column names. SQLite is CASE-INSENSITIVE for column names, so
    // "Full Name", "full name", "FULL NAME" all collide as the same column
    // and CREATE TABLE fails with "duplicate column name". Dedup using a
    // case-insensitive key (and also collapse internal whitespace) so the
    // generated CREATE TABLE never has duplicates.
    const seen = new Map<string, number>();
    const columns = headerRow.map((name) => {
      const key = name.toLowerCase().replace(/\s+/g, " ");
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      return n === 0 ? name : `${name}_${n + 1}`;
    });

    const dataRows = aoa.slice(1).filter((r) =>
      (r as unknown[]).some((v) => v !== null && v !== undefined && v !== "")
    );
    const rows: Record<string, unknown>[] = dataRows.map((r) => {
      const arr = r as unknown[];
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        const v = arr[i] ?? null;
        // When raw:false, numeric cells come back as strings too. Try to
        // coerce pure-numeric values back to numbers so SQL math works.
        // But preserve date-formatted strings as strings.
        if (typeof v === "string" && v !== "" && /^-?\d+(\.\d+)?$/.test(v)) {
          obj[col] = Number(v);
        } else {
          obj[col] = v;
        }
      });
      return obj;
    });
    const dtypes = columns.map((col) => inferDtype(rows.slice(0, 100).map((r) => r[col])));

    // Table name: for CSV, use the filename. For XLSX, use the sheet name.
    let tableName: string;
    if (isCsvLike) {
      tableName = baseName;
    } else {
      tableName = sheetName.replace(/[^a-zA-Z0-9_]/g, "_") || `sheet_${tables.length + 1}`;
    }
    // Avoid duplicate table names across sheets.
    let uniqueName = tableName;
    let n = 2;
    while (tables.some((t) => t.name === uniqueName)) {
      uniqueName = `${tableName}_${n++}`;
    }

    tables.push({
      name: uniqueName,
      columns: columns.map((name, i) => ({ name, dtype: dtypes[i] })),
      rows,
    });
  }

  if (!tables.length) throw new Error("The file has no readable sheets.");
  if (!tables[0].columns.length) throw new Error("The first sheet has no columns.");
  if (!tables[0].rows.length) throw new Error("The first sheet has no data rows.");

  return { tables };
}

function inferDtype(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (!nonNull.length) return "text";
  const nums = nonNull.filter((v) => typeof v === "number" || (!Number.isNaN(Number(v)) && v !== ""));
  if (nums.length >= nonNull.length * 0.8) return "number";
  // Date detection — support ISO (yyyy-mm-dd), US (m/d/yyyy), and various
  // human-readable formats. Catches what the xlsx library emits when
  // raw:false is set (it formats date cells to locale strings).
  const dateRegex = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/; // ISO
  const usDateRegex = /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?$/i; // m/d/yyyy
  const textualDateRegex = /^\d{1,2}-\w{3}-\d{2,4}$/i; // 15-Jan-2024
  const dates = nonNull.filter((v) =>
    typeof v === "string" && (
      dateRegex.test(v)
      || usDateRegex.test(v)
      || textualDateRegex.test(v)
    )
    || v instanceof Date
  );
  if (dates.length >= nonNull.length * 0.8) return "date";
  const bools = nonNull.filter((v) =>
    typeof v === "boolean" || /^(true|false|yes|no|0|1)$/i.test(String(v))
  );
  if (bools.length === nonNull.length) return "boolean";
  return "text";
}
