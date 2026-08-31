/**
 * ClassicConnection — a DbConnection implementation for SelectStar Classic.
 *
 * ARCHITECTURE: Instead of a custom SQL parser, we load uploaded CSV/XLSX
 * rows into an in-memory SQLite database (via better-sqlite3). This gives
 * us FULL SQL support for free: JOINs across multiple uploaded files,
 * subqueries, CTEs, window functions, aggregates, etc. The AI agent writes
 * standard SQLite SQL and it just works.
 *
 * Multi-file workspace: a single Classic session can hold MANY tables (one
 * per uploaded file, or one per XLSX sheet). Each table is created in the
 * same in-memory SQLite database, so the agent can join across them:
 *
 *   SELECT c.name, SUM(o.total) AS spend
 *   FROM orders o JOIN customers c ON o.customer_id = c.id
 *   GROUP BY c.name ORDER BY spend DESC
 *
 * Writes (INSERT/UPDATE/DELETE) mutate the SQLite tables directly. The
 * download endpoint reads the tables back out and serialises to CSV/XLSX.
 */
import type {
  ColumnInfo,
  Dialect,
  SchemaSnapshot,
  TableInfo,
} from "@/lib/types";
import type {
  DbConnection,
  QueryResult,
  WriteResult,
} from "@/lib/db-connection";
import type Database from "better-sqlite3";

export interface ClassicTable {
  name: string;
  columns: { name: string; dtype?: string }[];
  rows: Record<string, unknown>[];
  sourceFile?: string;
  /** Pre-computed EDA profile (nulls, uniques, distributions) — shown in UI. */
  profile?: ClassicTableProfile;
}

export interface ClassicTableProfile {
  columns: {
    name: string;
    dtype: string;
    nulls: number;
    nullPct: number;
    unique: number;
    min?: number | null;
    max?: number | null;
    mean?: number | null;
    median?: number | null;
    std?: number | null;
    topValues?: { value: string; count: number }[];
  }[];
  rowCount: number;
  computedAt: string;
}

interface ClassicDataset {
  tables: Map<string, ClassicTable>;
  edits: { sql: string; rowsAffected: number; ts: number }[];
  filePaths: string[];
}

// ---------------------------------------------------------------------------
// In-memory registry — keyed by sessionId. Survives HMR in dev.
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, ClassicConnection>();
const globalForClassic = globalThis as unknown as {
  __classicRegistry?: Map<string, ClassicConnection>;
};
if (globalForClassic.__classicRegistry) {
  (globalForClassic.__classicRegistry as Map<string, ClassicConnection>).forEach(
    (conn, id) => REGISTRY.set(id, conn)
  );
}
globalForClassic.__classicRegistry = REGISTRY;

/**
 * Register a freshly-parsed CSV/XLSX dataset under a sessionId.
 * For multi-file workspaces, call addTable() afterwards.
 */
export function registerClassicDataset(
  sessionId: string,
  table: Omit<ClassicTable, "profile">,
  filePath?: string
): SchemaSnapshot {
  const existing = REGISTRY.get(sessionId);
  if (existing) {
    existing.addTable(table);
    return existing.buildSchemaSnapshot();
  }
  const conn = new ClassicConnection(sessionId, {
    tables: new Map(),
    edits: [],
    filePaths: filePath ? [filePath] : [],
  });
  conn.addTable(table, filePath);
  REGISTRY.set(sessionId, conn);
  return conn.buildSchemaSnapshot();
}

export function getClassicConnection(sessionId: string): ClassicConnection | undefined {
  return REGISTRY.get(sessionId);
}

/**
 * Re-hydrate a Classic session after a server restart by re-reading the
 * files from disk. The connectionString is a JSON array of paths.
 */
export async function reopenClassicFromDisk(
  sessionId: string,
  connectionString: string
): Promise<ClassicConnection | undefined> {
  const existing = REGISTRY.get(sessionId);
  if (existing) return existing;

  // connectionString is either "classic://<path>" (single file, old format)
  // or "classic-multi://[<path1>,<path2>,...]" (multi-file, new format).
  try {
    if (connectionString.startsWith("classic-multi://")) {
      const pathsJson = connectionString.slice("classic-multi://".length);
      const paths = JSON.parse(pathsJson) as string[];
      const { parseFile } = await import("./classic-parser");
      const conn = new ClassicConnection(sessionId, {
        tables: new Map(),
        edits: [],
        filePaths: paths,
      });
      for (const p of paths) {
        try {
          const parsed = await parseFile(p);
          for (const t of parsed.tables) {
            conn.addTable(t, p);
          }
        } catch (e) {
          console.warn(`[classic] couldn't re-hydrate ${p}:`, (e as Error).message);
        }
      }
      if (conn.listTables().length === 0) return undefined;
      REGISTRY.set(sessionId, conn);
      return conn;
    }
    if (connectionString.startsWith("classic://")) {
      const filePath = connectionString.slice("classic://".length);
      const { parseFile } = await import("./classic-parser");
      const parsed = await parseFile(filePath);
      const conn = new ClassicConnection(sessionId, {
        tables: new Map(),
        edits: [],
        filePaths: [filePath],
      });
      for (const t of parsed.tables) conn.addTable(t, filePath);
      REGISTRY.set(sessionId, conn);
      return conn;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// ClassicConnection
// ---------------------------------------------------------------------------

export class ClassicConnection implements DbConnection {
  readonly dialect: Dialect;
  private dataset: ClassicDataset;
  private db: Database.Database;
  private sessionId: string;

  constructor(sessionId: string, dataset: ClassicDataset) {
    this.sessionId = sessionId;
    this.dataset = dataset;
    // Detect dialect from the first file path.
    const fp = dataset.filePaths[0] ?? "";
    this.dialect = /\.(xlsx|xlsm|xlsb|ods)$/i.test(fp) ? "xlsx" : "csv";
    // Open an in-memory SQLite database. Lazily require better-sqlite3 so
    // client bundles never pull the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    this.db = new Database(":memory:");
    // Create all tables that were passed in the constructor (used by reopen).
    for (const table of dataset.tables.values()) {
      this.createSqliteTable(table);
    }
  }

  // -- Table management ---------------------------------------------------

  /**
   * Add a table to the workspace. Creates a SQLite table and inserts all
   * rows. Computes the EDA profile. Safe to call multiple times (e.g. for
   * multi-file uploads).
   */
  addTable(table: Omit<ClassicTable, "profile">, sourceFile?: string): void {
    if (this.dataset.tables.has(table.name)) {
      // Rename to avoid collision.
      let n = 2;
      while (this.dataset.tables.has(`${table.name}_${n}`)) n++;
      table = { ...table, name: `${table.name}_${n}` };
    }
    const tableWithProfile: ClassicTable = {
      ...table,
      sourceFile,
      profile: computeProfile(table.columns, table.rows),
    };
    this.dataset.tables.set(table.name, tableWithProfile);
    if (sourceFile && !this.dataset.filePaths.includes(sourceFile)) {
      this.dataset.filePaths.push(sourceFile);
    }
    this.createSqliteTable(tableWithProfile);
  }

  listTables(): string[] {
    return [...this.dataset.tables.keys()];
  }

  getTable(name: string): ClassicTable | undefined {
    return this.dataset.tables.get(name);
  }

  /** Read a table back from SQLite for the spreadsheet view / download. */
  getRows(tableName?: string): { columns: { name: string; dtype?: string }[]; rows: Record<string, unknown>[] } {
    const tname = tableName ?? this.listTables()[0];
    if (!tname) return { columns: [], rows: [] };
    const table = this.dataset.tables.get(tname);
    if (!table) return { columns: [], rows: [] };
    try {
      const rows = this.db.prepare(`SELECT * FROM ${quoteIdent(tname)}`).all() as Record<string, unknown>[];
      return { columns: table.columns, rows };
    } catch {
      return { columns: table.columns, rows: table.rows };
    }
  }

  getEdits(): { sql: string; rowsAffected: number; ts: number }[] {
    return this.dataset.edits;
  }

  getAllTables(): ClassicTable[] {
    return [...this.dataset.tables.values()];
  }

  // -- Direct cell-edit API (used by the spreadsheet grid) -----------------

  setCell(tableName: string, rowIdx: number, column: string, value: unknown): number {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    if (rowIdx < 0 || rowIdx >= table.rows.length) {
      throw new Error(`Row index ${rowIdx} is out of bounds (0..${table.rows.length - 1}).`);
    }
    if (!table.columns.some((c) => c.name === column)) {
      throw new Error(`Column "${column}" doesn't exist in table "${tableName}".`);
    }
    const row = table.rows[rowIdx];
    // We need a stable row identifier. SQLite rows don't have rowids for
    // WITHOUT ROWID tables, but our tables are normal (with rowid). Use
    // rowid + 1 to match the displayed 1-indexed row number.
    const coerced = coerceValue(value, table.columns.find((c) => c.name === column)?.dtype);
    // Find the rowid by selecting the Nth row.
    const rowidRow = this.db.prepare(
      `SELECT rowid FROM ${quoteIdent(tableName)} LIMIT 1 OFFSET ?`
    ).get(rowIdx) as { rowid: number } | undefined;
    if (!rowidRow) throw new Error(`Couldn't locate row ${rowIdx + 1} in SQLite.`);
    this.db.prepare(
      `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`
    ).run(coerced, rowidRow.rowid);
    // Update the in-memory copy too (kept in sync for the spreadsheet view).
    table.rows[rowIdx][column] = coerced;
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: ${tableName} row ${rowIdx + 1}, ${column} = ${JSON.stringify(coerced)}`,
      rowsAffected: 1,
      ts: Date.now(),
    });
    return table.rows.length;
  }

  addRow(tableName: string, partial?: Record<string, unknown>): { rowIndex: number; totalRows: number } {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    const row: Record<string, unknown> = {};
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const c of table.columns) {
      const v = coerceValue(partial?.[c.name] ?? null, c.dtype);
      row[c.name] = v;
      cols.push(quoteIdent(c.name));
      vals.push(v);
    }
    const placeholders = cols.map(() => "?").join(", ");
    this.db.prepare(
      `INSERT INTO ${quoteIdent(tableName)} (${cols.join(", ")}) VALUES (${placeholders})`
    ).run(...vals);
    table.rows.push(row);
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: appended row to ${tableName}`,
      rowsAffected: 1,
      ts: Date.now(),
    });
    return { rowIndex: table.rows.length - 1, totalRows: table.rows.length };
  }

  deleteRow(tableName: string, rowIdx: number): number {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    if (rowIdx < 0 || rowIdx >= table.rows.length) {
      throw new Error(`Row index ${rowIdx} is out of bounds (0..${table.rows.length - 1}).`);
    }
    const rowidRow = this.db.prepare(
      `SELECT rowid FROM ${quoteIdent(tableName)} LIMIT 1 OFFSET ?`
    ).get(rowIdx) as { rowid: number } | undefined;
    if (!rowidRow) throw new Error(`Couldn't locate row ${rowIdx + 1} in SQLite.`);
    this.db.prepare(
      `DELETE FROM ${quoteIdent(tableName)} WHERE rowid = ?`
    ).run(rowidRow.rowid);
    table.rows.splice(rowIdx, 1);
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: deleted row ${rowIdx + 1} from ${tableName}`,
      rowsAffected: 1,
      ts: Date.now(),
    });
    return table.rows.length;
  }

  renameColumn(tableName: string, oldName: string, newName: string): void {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    if (!table.columns.some((c) => c.name === oldName)) {
      throw new Error(`Column "${oldName}" doesn't exist in table "${tableName}".`);
    }
    if (table.columns.some((c) => c.name === newName)) {
      throw new Error(`A column named "${newName}" already exists in table "${tableName}".`);
    }
    // SQLite supports ALTER TABLE ... RENAME COLUMN (>= 3.25).
    this.db.prepare(
      `ALTER TABLE ${quoteIdent(tableName)} RENAME COLUMN ${quoteIdent(oldName)} TO ${quoteIdent(newName)}`
    ).run();
    table.columns = table.columns.map((c) =>
      c.name === oldName ? { ...c, name: newName } : c
    );
    table.rows = table.rows.map((r) => {
      const next: Record<string, unknown> = {};
      for (const k of Object.keys(r)) next[k === oldName ? newName : k] = r[k];
      return next;
    });
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: ${tableName}.${oldName} → ${newName}`,
      rowsAffected: table.rows.length,
      ts: Date.now(),
    });
  }

  addColumn(tableName: string, name: string, dtype?: string): void {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    if (table.columns.some((c) => c.name === name)) {
      throw new Error(`A column named "${name}" already exists in table "${tableName}".`);
    }
    const sqliteType = dtypeToSqlite(dtype || "text");
    this.db.prepare(
      `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${quoteIdent(name)} ${sqliteType}`
    ).run();
    table.columns.push({ name, dtype: dtype || "text" });
    for (const r of table.rows) r[name] = null;
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: added column ${tableName}.${name}`,
      rowsAffected: table.rows.length,
      ts: Date.now(),
    });
  }

  deleteColumn(tableName: string, name: string): void {
    const table = this.dataset.tables.get(tableName);
    if (!table) throw new Error(`Table "${tableName}" doesn't exist.`);
    if (!table.columns.some((c) => c.name === name)) {
      throw new Error(`Column "${name}" doesn't exist in table "${tableName}".`);
    }
    // SQLite >= 3.35 supports DROP COLUMN.
    this.db.prepare(
      `ALTER TABLE ${quoteIdent(tableName)} DROP COLUMN ${quoteIdent(name)}`
    ).run();
    table.columns = table.columns.filter((c) => c.name !== name);
    for (const r of table.rows) delete r[name];
    this.dataset.edits.push({
      sql: `-- spreadsheet edit: dropped column ${tableName}.${name}`,
      rowsAffected: table.rows.length,
      ts: Date.now(),
    });
  }

  // -- DbConnection impl ---------------------------------------------------

  async ping(): Promise<void> {
    if (!this.dataset.tables.size) throw new Error("Empty workspace — no tables loaded.");
    this.db.prepare("SELECT 1").get();
  }

  async introspect(): Promise<SchemaSnapshot> {
    return this.buildSchemaSnapshot();
  }

  async query(sql: string, _limit = 500): Promise<QueryResult> {
    const start = Date.now();
    const trimmed = sql.trim().replace(/;$/, "");
    if (!/^select\b/i.test(trimmed)) {
      throw new Error("Classic mode only supports SELECT for reads. To modify data, ask me to update or delete rows — Zen mode will gate the change.");
    }
    try {
      const stmt = this.db.prepare(trimmed);
      const rows = stmt.all() as Record<string, unknown>[];
      // Derive columns from stmt.columns() if available, else from the first row.
      let columns: { name: string; dtype?: string }[] = [];
      try {
        const stmtCols = (this.db.prepare(trimmed).columns?.() as { name: string; type?: string }[] | undefined);
        if (stmtCols && stmtCols.length) {
          columns = stmtCols.map((c) => ({ name: c.name, dtype: c.type }));
        }
      } catch { /* columns() not available for some queries */ }
      if (!columns.length && rows.length) {
        columns = Object.keys(rows[0]).map((name) => ({ name }));
      }
      return {
        columns,
        rows,
        rowCount: rows.length,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      throw new Error(`SQL error: ${(e as Error).message}`);
    }
  }

  async executeWrite(sql: string, opts?: { rollback?: boolean }): Promise<WriteResult> {
    const start = Date.now();
    const trimmed = sql.trim().replace(/;$/, "");
    if (!/^(insert|update|delete|drop|alter|create|truncate)\b/i.test(trimmed)) {
      throw new Error(`Unsupported write statement: ${trimmed.slice(0, 80)}…`);
    }
    try {
      if (opts?.rollback) {
        // Dry-run inside a transaction we roll back.
        const tx = this.db.transaction(() => {
          const r = this.db.prepare(trimmed).run();
          return { rowsAffected: r.changes };
        });
        // Run inside a savepoint we can roll back without affecting the
        // outer connection (better-sqlite3 doesn't expose nested transactions
        // directly, but `transaction` + immediate rollback works).
        this.db.exec("SAVEPOINT zenDryRun");
        let rowsAffected = 0;
        try {
          rowsAffected = tx().rowsAffected;
        } finally {
          this.db.exec("ROLLBACK TO zenDryRun");
          this.db.exec("RELEASE zenDryRun");
        }
        return { rowsAffected, durationMs: Date.now() - start };
      }
      const r = this.db.prepare(trimmed).run();
      // Sync the in-memory copies of any affected tables. Cheapest approach:
      // re-read the affected table(s) from SQLite. We don't know which tables
      // were affected without parsing the SQL, so we re-read ALL tables.
      // For workspaces with few tables this is fast enough.
      for (const tname of this.dataset.tables.keys()) {
        const t = this.dataset.tables.get(tname)!;
        try {
          t.rows = this.db.prepare(`SELECT * FROM ${quoteIdent(tname)}`).all() as Record<string, unknown>[];
        } catch { /* ignore */ }
      }
      this.dataset.edits.push({ sql: trimmed, rowsAffected: r.changes, ts: Date.now() });
      return { rowsAffected: r.changes, durationMs: Date.now() - start };
    } catch (e) {
      throw new Error(`Write error: ${(e as Error).message}`);
    }
  }

  async detectCanWrite(): Promise<boolean> {
    return true;
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }

  // -- internals -----------------------------------------------------------

  private createSqliteTable(table: ClassicTable): void {
    // Drop if exists (for re-hydration).
    this.db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table.name)}`);
    const colDefs = table.columns.map((c) => {
      const sqliteType = dtypeToSqlite(c.dtype || "text");
      return `${quoteIdent(c.name)} ${sqliteType}`;
    });
    this.db.exec(`CREATE TABLE ${quoteIdent(table.name)} (${colDefs.join(", ")})`);
    // Insert all rows.
    if (table.rows.length) {
      const cols = table.columns.map((c) => quoteIdent(c.name)).join(", ");
      const placeholders = table.columns.map(() => "?").join(", ");
      const insert = this.db.prepare(
        `INSERT INTO ${quoteIdent(table.name)} (${cols}) VALUES (${placeholders})`
      );
      const insertMany = this.db.transaction((rows: Record<string, unknown>[]) => {
        for (const r of rows) {
          insert.run(...table.columns.map((c) => r[c.name] ?? null));
        }
      });
      insertMany(table.rows);
    }
  }

  buildSchemaSnapshot(): SchemaSnapshot {
    const tables: TableInfo[] = [];
    for (const t of this.dataset.tables.values()) {
      const colInfos: ColumnInfo[] = t.columns.map((c) => ({
        name: c.name,
        dataType: c.dtype || "text",
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
        references: null,
      }));
      tables.push({
        name: t.name,
        columns: colInfos,
        rowCount: t.rows.length,
        description: t.sourceFile
          ? `Uploaded from ${t.sourceFile.split("/").pop()} (${t.columns.length} cols, ${t.rows.length.toLocaleString()} rows).`
          : `Uploaded ${t.columns.length}-column dataset (${t.rows.length.toLocaleString()} rows).`,
      });
    }
    return {
      dialect: this.dialect,
      database: "classic-workspace",
      tables,
      introspectedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function dtypeToSqlite(dtype: string): string {
  const d = (dtype || "text").toLowerCase();
  if (d === "number" || d === "numeric" || d === "decimal") return "REAL";
  if (d === "integer" || d === "int" || d === "boolean") return "INTEGER";
  if (d === "date" || d === "datetime") return "TEXT"; // SQLite stores dates as TEXT by default
  return "TEXT";
}

function coerceValue(value: unknown, dtype?: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return null;
    if (dtype === "number") {
      const n = Number(s);
      return Number.isNaN(n) ? s : n;
    }
    if (dtype === "boolean") {
      if (/^(true|yes|1)$/i.test(s)) return 1;
      if (/^(false|no|0)$/i.test(s)) return 0;
      return s;
    }
    return s;
  }
  return value;
}

// ---------------------------------------------------------------------------
// EDA profile — computed once on upload, shown in the UI
// ---------------------------------------------------------------------------

function computeProfile(
  columns: { name: string; dtype?: string }[],
  rows: Record<string, unknown>[]
): ClassicTableProfile {
  const colProfiles: ClassicTableProfile["columns"] = columns.map((c) => {
    const values = rows.map((r) => r[c.name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    const nulls = values.length - nonNull.length;
    const nullPct = values.length ? (nulls / values.length) * 100 : 0;
    const uniqueSet = new Set(nonNull.map((v) => String(v)));
    const unique = uniqueSet.size;
    const dtype = c.dtype || inferDtype(nonNull);

    if (dtype === "number") {
      const nums = nonNull.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b);
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / nums.length;
        const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
        const std = Math.sqrt(variance);
        return {
          name: c.name,
          dtype,
          nulls,
          nullPct,
          unique,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean,
          median: percentile(sorted, 0.5),
          std,
        };
      }
    }

    // Categorical: top values.
    const freq = new Map<string, number>();
    for (const v of nonNull) {
      const key = String(v);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    return { name: c.name, dtype, nulls, nullPct, unique, topValues };
  });

  return {
    columns: colProfiles,
    rowCount: rows.length,
    computedAt: new Date().toISOString(),
  };
}

function inferDtype(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (!nonNull.length) return "text";
  const nums = nonNull.filter((v) => typeof v === "number" || (!Number.isNaN(Number(v)) && v !== ""));
  if (nums.length >= nonNull.length * 0.8) return "number";
  const bools = nonNull.filter((v) => typeof v === "boolean" || /^(true|false|yes|no|0|1)$/i.test(String(v)));
  if (bools.length === nonNull.length) return "boolean";
  return "text";
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
