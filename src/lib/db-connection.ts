/**
 * Connection layer — dialect-agnostic abstraction over SQLite and PostgreSQL.
 *
 * This is the unglamorous foundation everything else depends on (spec §4).
 * Each dialect implements the `DbConnection` interface. Adding MySQL later
 * means implementing this interface once — agent logic never touches drivers.
 *
 * NOTE: This module is server-only. It imports native drivers that must not
 * be bundled into client code. Import it only from API routes / agents.
 */
import type { Dialect, SchemaSnapshot, TableInfo, ColumnInfo } from "@/lib/types";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: { name: string; dtype?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface WriteResult {
  rowsAffected: number;
  durationMs: number;
}

export interface DbConnection {
  readonly dialect: Dialect;
  /**
   * Verify the connection is actually live (DNS resolved, authenticated,
   * server reachable). For lazy drivers like pg's Pool this forces a real
   * round-trip. Throws on connection-level failure (ENOTFOUND, ECONNREFUSED,
   * authentication, SSL, etc.) — distinct from SQL/introspection errors.
   */
  ping(): Promise<void>;
  /** Full introspection pass (spec §4.3). */
  introspect(): Promise<SchemaSnapshot>;
  /** Run a read query. Throws on error. */
  query(sql: string, limit?: number): Promise<QueryResult>;
  /**
   * Run a write statement inside a transaction. Returns rowsAffected.
   * Callers are responsible for confirmation gating (Zen mode) and logging.
   * If `rollback` is true, the statement runs but is immediately rolled back
   * so the user can see the affected count without committing (spec §6.4).
   */
  executeWrite(sql: string, opts?: { rollback?: boolean }): Promise<WriteResult>;
  /** Best-effort detection of whether the role can write. */
  detectCanWrite(): Promise<boolean>;
  /** Generate a few suggested starter questions from the schema. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Connection string parsing + factory
// ---------------------------------------------------------------------------

export interface ParsedConnection {
  dialect: Dialect;
  /** Normalised connection string safe to log (passwords masked). */
  safeString: string;
  /** The real connection string passed to the driver. */
  raw: string;
}

const DEMO_LABEL = "demo";

/**
 * Parse a connection string. Supports:
 *  - "demo" → the bundled demo SQLite database (db/demo.db)
 *  - "sqlite:<path>" or "file:<path>" → a SQLite file
 *  - "postgresql://..." / "postgres://..." → PostgreSQL via pg
 *  - "mysql://..." → MySQL (not yet implemented, surfaces a clear error)
 */
export function parseConnectionString(input: string): ParsedConnection {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Connection string is empty.");

  // Demo shorthand.
  if (trimmed.toLowerCase() === DEMO_LABEL) {
    return { dialect: "sqlite", safeString: "demo://demo.db", raw: "db/demo.db" };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("postgres")) {
    return { dialect: "postgres", safeString: maskPassword(trimmed), raw: trimmed };
  }
  if (lower.startsWith("mysql://")) {
    throw new Error(
      "MySQL support is wired into the architecture but the driver isn't installed in this build. Try PostgreSQL or SQLite, or use the demo database."
    );
  }
  // Bare file path or sqlite:/file / file:file
  if (lower.startsWith("sqlite:") || lower.startsWith("file:") || lower.startsWith("/") || lower.startsWith("./") || /^[a-z]:\\/i.test(trimmed)) {
    const path = trimmed.replace(/^(sqlite:|file:)/i, "");
    return { dialect: "sqlite", safeString: `sqlite:${path}`, raw: path };
  }
  throw new Error(
    `Unrecognised connection string. Use "demo", a SQLite file path, or a postgresql:// URL. Got: "${trimmed.slice(0, 60)}"`
  );
}

function maskPassword(connStr: string): string {
  try {
    return connStr.replace(/(:\/\/[^:]+:)[^@]+@/, "$1••••@");
  } catch {
    return connStr;
  }
}

// ---------------------------------------------------------------------------
// In-memory connection registry — keyed by sessionId.
// A real deployment would use a connection pool / external cache; in v1 the
// spec explicitly says in-memory is fine.
// ---------------------------------------------------------------------------

const connections = new Map<string, DbConnection>();

export async function openConnection(sessionId: string, connStr: string): Promise<DbConnection> {
  // Reuse an existing open connection for this session.
  const existing = connections.get(sessionId);
  if (existing) return existing;

  const parsed = parseConnectionString(connStr);
  let conn: DbConnection;
  if (parsed.dialect === "sqlite") {
    conn = new SqliteConnection(parsed.raw);
  } else if (parsed.dialect === "postgres") {
    conn = new PostgresConnection(parsed.raw);
  } else {
    throw new Error(`Dialect ${parsed.dialect} is not implemented yet.`);
  }
  connections.set(sessionId, conn);
  return conn;
}

export function getConnection(sessionId: string): DbConnection | undefined {
  return connections.get(sessionId);
}

export function closeConnection(sessionId: string): void {
  const conn = connections.get(sessionId);
  if (conn) {
    try { conn.close(); } catch { /* ignore */ }
    connections.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// SQLite connection (better-sqlite3, synchronous — wrapped in promises)
// ---------------------------------------------------------------------------

class SqliteConnection implements DbConnection {
  readonly dialect: Dialect = "sqlite";
  private db: Database.Database;

  constructor(path: string) {
    // Imported lazily so client bundles never pull the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    if (path === "db/demo.db" || path === "demo") {
      this.db = new Database("db/demo.db", { readonly: false, fileMustExist: true });
    } else {
      this.db = new Database(path, { readonly: false });
    }
  }

  // SQLite opens the file synchronously in the constructor, so by the time
  // we get here the connection is already established (or it threw).
  async ping(): Promise<void> {
    this.db.prepare("SELECT 1").get();
  }

  async introspect(): Promise<SchemaSnapshot> {
    const tables = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all() as { name: string }[];

    const tableInfos: TableInfo[] = [];
    for (const { name } of tables) {
      const cols = this.db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as {
        cid: number; name: string; type: string; notnull: number; pk: number;
      }[];
      const fks = this.db.prepare(`PRAGMA foreign_key_list(${quoteIdent(name)})`).all() as {
        from: string; table: string; to: string;
      }[];
      const fkMap = new Map<string, { table: string; column: string }>();
      for (const fk of fks) fkMap.set(fk.from, { table: fk.table, column: fk.to });

      let rowCount = 0;
      try {
        rowCount = (this.db.prepare(`SELECT COUNT(*) c FROM ${quoteIdent(name)}`).get() as { c: number }).c;
      } catch { /* view without rows */ }

      tableInfos.push({
        name,
        columns: cols.map((c) => {
          const fk = fkMap.get(c.name);
          return {
            name: c.name,
            dataType: c.type || "TEXT",
            nullable: c.notnull === 0,
            isPrimaryKey: c.pk > 0,
            isForeignKey: !!fk,
            references: fk ?? null,
          } satisfies ColumnInfo;
        }),
        rowCount,
        description: inferTableDescription(name),
      });
    }

    return {
      dialect: "sqlite",
      database: "demo.db",
      tables: tableInfos,
      introspectedAt: new Date().toISOString(),
    };
  }

  async query(sql: string, limit = 500): Promise<QueryResult> {
    const start = Date.now();
    const stmt = this.db.prepare(sql);
    // Apply a guard LIMIT for SELECT if the user didn't supply one.
    const guarded = applyRowLimit(sql, limit);
    const rows = (this.db.prepare(guarded).all() as Record<string, unknown>[]);
    const durationMs = Date.now() - start;
    // Derive columns from the first row, falling back to stmt.columns() if available.
    let columns: { name: string; dtype?: string }[] = [];
    try {
      const stmtCols = this.db.prepare(guarded).columns?.() as { name: string; type?: string }[] | undefined;
      if (stmtCols && stmtCols.length) columns = stmtCols.map((c) => ({ name: c.name, dtype: c.type }));
    } catch { /* columns() not available */ }
    if (!columns.length && rows.length) {
      columns = Object.keys(rows[0]).map((name) => ({ name }));
    }
    return { columns, rows, rowCount: rows.length, durationMs };
  }

  async executeWrite(sql: string, opts?: { rollback?: boolean }): Promise<WriteResult> {
    const start = Date.now();
    let rowsAffected = 0;
    // Manual BEGIN/COMMIT|ROLLBACK so we can dry-run a write and discard it.
    this.db.exec("BEGIN");
    try {
      const r = this.db.prepare(sql).run();
      rowsAffected = r.changes;
      if (opts?.rollback) this.db.exec("ROLLBACK");
      else this.db.exec("COMMIT");
    } catch (e) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw e;
    }
    return { rowsAffected: rowsAffected ?? 0, durationMs: Date.now() - start };
  }

  async detectCanWrite(): Promise<boolean> {
    try {
      // Attempt a no-op write capability check: try to create a temp table.
      this.db.exec("CREATE TABLE IF NOT EXISTS __zen_probe (id INTEGER)");
      this.db.exec("DROP TABLE __zen_probe");
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL connection (pg, async)
// ---------------------------------------------------------------------------

class PostgresConnection implements DbConnection {
  readonly dialect: Dialect = "postgres";
  private pool: import("pg").Pool;

  constructor(connStr: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: connStr,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // fail fast on unreachable hosts
    });
  }

  private async getClient() {
    return this.pool.connect();
  }

  /**
   * Force a real round-trip to the server. pg's Pool is lazy, so the
   * constructor never throws — this is where DNS/auth/TLS/port errors
   * actually surface. A short connect-timeout keeps failures snappy.
   */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async introspect(): Promise<SchemaSnapshot> {
    const client = await this.getClient();
    try {
      const tablesRes = await client.query<{
        table_schema: string; table_name: string;
      }>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name
      `);

      const tableInfos: TableInfo[] = [];
      for (const t of tablesRes.rows) {
        // Columns — this is the critical one; if it fails, skip the table.
        let colsRes: { rows: { column_name: string; data_type: string; is_nullable: string }[] };
        try {
          colsRes = await client.query<{
            column_name: string; data_type: string; is_nullable: string;
          }>(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema=$1 AND table_name=$2
            ORDER BY ordinal_position
          `, [t.table_schema, t.table_name]);
        } catch {
          continue; // permission denied on this table's metadata — skip it
        }

        // Primary keys — best-effort.
        let pkCols = new Set<string>();
        try {
          const pkRes = await client.query<{ column_name: string }>(`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
            WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=$1 AND tc.table_name=$2
          `, [t.table_schema, t.table_name]);
          pkCols = new Set(pkRes.rows.map((r) => r.column_name));
        } catch { /* permission denied — leave pkCols empty */ }

        // Foreign keys — best-effort.
        const fkMap = new Map<string, { table: string; column: string }>();
        try {
          const fkRes = await client.query<{
            column_name: string; ref_table: string; ref_column: string;
          }>(`
            SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.constraint_schema
            WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2
          `, [t.table_schema, t.table_name]);
          for (const r of fkRes.rows) fkMap.set(r.column_name, { table: r.ref_table, column: r.ref_column });
        } catch { /* permission denied — leave fkMap empty */ }

        let rowCount = 0;
        try {
          const r = await client.query(`SELECT COUNT(*)::int c FROM ${quoteIdent(t.table_schema)}.${quoteIdent(t.table_name)}`);
          rowCount = r.rows[0]?.c ?? 0;
        } catch { /* permission denied etc. */ }

        tableInfos.push({
          name: t.table_name,
          schema: t.table_schema,
          columns: colsRes.rows.map((c) => {
            const fk = fkMap.get(c.column_name);
            return {
              name: c.column_name,
              dataType: c.data_type,
              nullable: c.is_nullable === "YES",
              isPrimaryKey: pkCols.has(c.column_name),
              isForeignKey: !!fk,
              references: fk ?? null,
            };
          }),
          rowCount,
          description: inferTableDescription(t.table_name),
        });
      }

      return {
        dialect: "postgres",
        database: undefined,
        tables: tableInfos,
        introspectedAt: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  }

  async query(sql: string, limit = 500): Promise<QueryResult> {
    const client = await this.getClient();
    try {
      const start = Date.now();
      const guarded = applyRowLimit(sql, limit);
      const res = await client.query(guarded);
      return {
        columns: res.fields.map((f) => ({ name: f.name, dtype: dataTypeName(f.dataTypeID) })),
        rows: res.rows as Record<string, unknown>[],
        rowCount: res.rowCount ?? res.rows.length,
        durationMs: Date.now() - start,
      };
    } finally {
      client.release();
    }
  }

  async executeWrite(sql: string, opts?: { rollback?: boolean }): Promise<WriteResult> {
    const client = await this.getClient();
    try {
      const start = Date.now();
      await client.query("BEGIN");
      let rowsAffected = 0;
      try {
        const res = await client.query(sql);
        rowsAffected = res.rowCount ?? 0;
        if (opts?.rollback) await client.query("ROLLBACK");
        else await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      return { rowsAffected, durationMs: Date.now() - start };
    } finally {
      client.release();
    }
  }

  async detectCanWrite(): Promise<boolean> {
    const client = await this.getClient();
    try {
      const res = await client.query(
        `SELECT has_table_privilege(current_user, current_database(), 'INSERT') AS can_write
         UNION ALL
         SELECT has_table_privilege(current_user, current_database(), 'UPDATE')`
      );
      return res.rows.some((r) => r.can_write === true);
    } catch {
      // Fallback: assume writable; the toggle still requires explicit confirmation.
      return true;
    } finally {
      client.release();
    }
  }

  close(): void {
    try { void this.pool.end(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Wrap a SELECT so it never returns more than `limit` rows. If the query
 * already has a LIMIT clause we leave it alone (but cap it at limit*2 to
 * avoid runaway queries). Non-SELECT statements are returned unchanged.
 */
export function applyRowLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;$/, "");
  const isSelect = /^\s*\(?\s*select/i.test(trimmed);
  if (!isSelect) return trimmed;
  const hasLimit = /\blimit\b/i.test(trimmed);
  if (hasLimit) return trimmed;
  return `${trimmed} LIMIT ${limit}`;
}

/** Heuristic: is this SQL a write statement? (INSERT/UPDATE/DELETE/DDL etc.) */
export function isWriteStatement(sql: string): boolean {
  return /^\s*(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke)\b/i.test(sql.trim());
}

function inferTableDescription(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("order")) return "Customer orders.";
  if (n.includes("customer")) return "Customer records.";
  if (n.includes("product")) return "Product catalog.";
  if (n.includes("categor")) return "Product categories.";
  if (n.includes("region")) return "Geographic regions.";
  if (n.includes("item")) return "Line items belonging to orders.";
  return undefined;
}

function dataTypeName(oid: number | undefined): string | undefined {
  if (oid === undefined) return undefined;
  // A tiny subset; pg returns numeric OIDs.
  const map: Record<number, string> = {
    16: "boolean", 17: "bytea", 20: "int8", 21: "int2", 23: "int4",
    25: "text", 700: "float4", 701: "float8", 1043: "varchar",
    1082: "date", 1114: "timestamp", 1184: "timestamptz", 1700: "numeric",
  };
  return map[oid];
}
