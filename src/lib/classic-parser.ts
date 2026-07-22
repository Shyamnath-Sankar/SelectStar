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
      raw: true,
      defval: null,
      blankrows: false,
    });
    if (!aoa.length) continue;

    const headerRow = (aoa[0] as unknown[]).map((h, i) =>
      h === null || h === undefined || h === "" ? `column_${i + 1}` : String(h).trim()
    );
    const seen = new Map<string, number>();
    const columns = headerRow.map((name) => {
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      return n === 0 ? name : `${name}_${n + 1}`;
    });

    const dataRows = aoa.slice(1).filter((r) =>
      (r as unknown[]).some((v) => v !== null && v !== undefined && v !== "")
    );
    const rows: Record<string, unknown>[] = dataRows.map((r) => {
      const arr = r as unknown[];
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => { obj[col] = arr[i] ?? null; });
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
  const dates = nonNull.filter((v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) || v instanceof Date
  );
  if (dates.length >= nonNull.length * 0.8) return "date";
  const bools = nonNull.filter((v) =>
    typeof v === "boolean" || /^(true|false|yes|no|0|1)$/i.test(String(v))
  );
  if (bools.length === nonNull.length) return "boolean";
  return "text";
}
