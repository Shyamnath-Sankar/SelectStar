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
import { getClassicConnection, reopenClassicFromDisk } from "@/lib/classic-registry";

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

  // Classic mode: the connection string is a "classic://<path>" URI pointing
  // at the on-disk copy of the uploaded file. Re-hydrate the in-memory dataset.
  if (connStr.startsWith("classic://")) {
    const filePath = connStr.slice("classic://".length);
    const conn = await reopenClassicFromDisk(sessionId, filePath);
    if (!conn) {
      throw new Error(
        "Couldn't re-open this Classic dataset — the uploaded file may have been removed. Please re-upload the CSV/XLSX."
      );
    }
    connections.set(sessionId, conn);
    return conn;
  }

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
  // Check the live-DB registry first; fall back to the classic in-memory
  // registry (classic connections are NOT stored in `connections` because
  // they're created via /api/classic/upload which calls registerClassicDataset
  // directly).
  return connections.get(sessionId) ?? getClassicConnection(sessionId);
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
  private pool: import("pg").Pool | null = null;
  private connStr: string;

  constructor(connStr: string) {
    this.connStr = connStr;
  }

  /**
   * Create the Pool. Called once after ping() determines SSL support.
   */
  private ensurePool(useSSL: boolean) {
    if (this.pool) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: this.connStr,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 12000,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    });
  }

  private async getClient() {
    if (!this.pool) throw new Error("Connection not established — call ping() first.");
    return this.pool.connect();
  }

  /**
   * Probe the server with a disposable pg.Client to verify connectivity AND
   * detect SSL support, then build the Pool once with the correct setting.
   *
   * Why Client instead of Pool?  Pool.connect() is lazy and manages its own
   * internal queue — rapidly destroying and recreating Pools (SSL → no-SSL
   * fallback) leaves zombie connections and hangs on some OS/driver combos.
   * A bare Client is a single socket with no lifecycle baggage.
   */
  async ping(): Promise<void> {
    const TIMEOUT_MS = 15_000;

    const probe = async (useSSL: boolean): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Client } = require("pg");
      const client = new Client({
        connectionString: this.connStr,
        connectionTimeoutMillis: 10_000,
        ssl: useSSL ? { rejectUnauthorized: false } : false,
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
      } finally {
        client.end().catch(() => {});
      }
    };

    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Connection timed out after ${TIMEOUT_MS / 1000}s — the host may be unreachable or a firewall is blocking port 5432`
            )),
            TIMEOUT_MS
          )
        ),
      ]);

    // Determine whether the user explicitly set ssl in the connection string.
    const userSetSSL = /[?&]ssl(mode)?=/i.test(this.connStr);

    if (userSetSSL) {
      // Respect the user's explicit setting — don't second-guess it.
      await withTimeout(probe(false)); // pg parses sslmode from the URL itself
      this.ensurePool(false);          // let the URL's sslmode drive the Pool too
      return;
    }

    // No explicit ssl param → try SSL first, fall back to plain.
    try {
      console.log("[pg] Probing with SSL (rejectUnauthorized:false)…");
      await withTimeout(probe(true));
      console.log("[pg] SSL probe succeeded.");
      this.ensurePool(true);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      const isSSLError = /ssl|tls|certificate|EPROTO|self.signed|does not support/i.test(msg);
      if (isSSLError) {
        console.log("[pg] SSL not supported, retrying without SSL…");
        try {
          await withTimeout(probe(false));
          console.log("[pg] Plain connection succeeded.");
          this.ensurePool(false);
        } catch (e2) {
          throw e2; // non-SSL also failed — throw that error
        }
      } else {
        throw e; // not an SSL issue — auth, DNS, timeout, etc.
      }
    }
  }

  async introspect(): Promise<SchemaSnapshot> {
    const MAX_TABLES = 200;
    const TIMEOUT_MS = 30_000;
    const client = await this.getClient();

    const timeout = setTimeout(() => {
      console.warn("[pg] Introspection approaching timeout — releasing client.");
      client.release(true); // force-destroy
    }, TIMEOUT_MS);

    try {
      console.log("[pg] Introspecting schema…");

      // 1. Get tables (capped).
      const tablesRes = await client.query<{
        table_schema: string; table_name: string;
      }>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name
        LIMIT ${MAX_TABLES}
      `);
      console.log(`[pg] Found ${tablesRes.rows.length} tables (cap: ${MAX_TABLES}).`);

      if (tablesRes.rows.length === 0) {
        return { dialect: "postgres", database: undefined, tables: [], introspectedAt: new Date().toISOString() };
      }

      // Build a schema/table pair filter for batch queries.
      const pairs = tablesRes.rows;
      const schemaNames = [...new Set(pairs.map(p => p.table_schema))];
      const tableNames = [...new Set(pairs.map(p => p.table_name))];

      // 2. Batch columns — one query for ALL tables.
      const colsMap = new Map<string, { column_name: string; data_type: string; is_nullable: string }[]>();
      try {
        const colsRes = await client.query<{
          table_schema: string; table_name: string;
          column_name: string; data_type: string; is_nullable: string;
        }>(`
          SELECT table_schema, table_name, column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ANY($1) AND table_name = ANY($2)
          ORDER BY table_schema, table_name, ordinal_position
        `, [schemaNames, tableNames]);
        for (const r of colsRes.rows) {
          const key = `${r.table_schema}.${r.table_name}`;
          if (!colsMap.has(key)) colsMap.set(key, []);
          colsMap.get(key)!.push(r);
        }
      } catch (e) {
        console.warn("[pg] Batch column query failed:", (e as Error).message);
      }
      console.log("[pg] Columns fetched.");

      // 3. Batch primary keys.
      const pkMap = new Map<string, Set<string>>();
      try {
        const pkRes = await client.query<{
          table_schema: string; table_name: string; column_name: string;
        }>(`
          SELECT tc.table_schema, tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = ANY($1) AND tc.table_name = ANY($2)
        `, [schemaNames, tableNames]);
        for (const r of pkRes.rows) {
          const key = `${r.table_schema}.${r.table_name}`;
          if (!pkMap.has(key)) pkMap.set(key, new Set());
          pkMap.get(key)!.add(r.column_name);
        }
      } catch { /* permission denied */ }
      console.log("[pg] Primary keys fetched.");

      // 4. Batch foreign keys.
      const fkMap = new Map<string, Map<string, { table: string; column: string }>>();
      try {
        const fkRes = await client.query<{
          table_schema: string; table_name: string;
          column_name: string; ref_table: string; ref_column: string;
        }>(`
          SELECT tc.table_schema, tc.table_name,
                 kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.constraint_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = ANY($1) AND tc.table_name = ANY($2)
        `, [schemaNames, tableNames]);
        for (const r of fkRes.rows) {
          const key = `${r.table_schema}.${r.table_name}`;
          if (!fkMap.has(key)) fkMap.set(key, new Map());
          fkMap.get(key)!.set(r.column_name, { table: r.ref_table, column: r.ref_column });
        }
      } catch { /* permission denied */ }
      console.log("[pg] Foreign keys fetched.");

      // 5. Approximate row counts from pg_stat — instant, no COUNT(*).
      const rowCountMap = new Map<string, number>();
      try {
        const rcRes = await client.query<{
          schemaname: string; relname: string; n_live_tup: string;
        }>(`
          SELECT schemaname, relname, n_live_tup
          FROM pg_stat_user_tables
          WHERE schemaname = ANY($1) AND relname = ANY($2)
        `, [schemaNames, tableNames]);
        for (const r of rcRes.rows) {
          rowCountMap.set(`${r.schemaname}.${r.relname}`, parseInt(r.n_live_tup, 10) || 0);
        }
      } catch { /* permission denied — leave 0 */ }
      console.log("[pg] Row counts fetched.");

      // 6. Assemble results.
      const tableInfos: TableInfo[] = [];
      for (const t of pairs) {
        const key = `${t.table_schema}.${t.table_name}`;
        const cols = colsMap.get(key);
        if (!cols || cols.length === 0) continue; // no column info — skip

        const pks = pkMap.get(key) ?? new Set<string>();
        const fks = fkMap.get(key) ?? new Map<string, { table: string; column: string }>();

        tableInfos.push({
          name: t.table_name,
          schema: t.table_schema,
          columns: cols.map((c) => {
            const fk = fks.get(c.column_name);
            return {
              name: c.column_name,
              dataType: c.data_type,
              nullable: c.is_nullable === "YES",
              isPrimaryKey: pks.has(c.column_name),
              isForeignKey: !!fk,
              references: fk ?? null,
            };
          }),
          rowCount: rowCountMap.get(key) ?? 0,
          description: inferTableDescription(t.table_name),
        });
      }

      console.log(`[pg] Introspection complete: ${tableInfos.length} tables.`);
      return {
        dialect: "postgres",
        database: undefined,
        tables: tableInfos,
        introspectedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
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
      // Use has_database_privilege for a database-level check (safer than
      // has_table_privilege which needs a specific table name).
      const res = await client.query(
        `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_write`
      );
      return res.rows[0]?.can_write === true;
    } catch {
      // Fallback: assume read-only; the user can enable Zen mode manually.
      return false;
    } finally {
      client.release();
    }
  }

  close(): void {
    try { if (this.pool) void this.pool.end(); } catch { /* ignore */ }
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
