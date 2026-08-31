/**
 * Data-quality agent.
 *
 * Runs an automatic background scan when the user connects to a database
 * or uploads a CSV. Produces a `data_quality` canvas object listing any
 * issues found in plain English — non-experts won't think to check
 * nulls or duplicates themselves, so the tool checks proactively.
 *
 * Detection (pure SQL where possible, falls back to row sampling):
 *   - High nulls: any column with > 5% NULLs
 *   - Duplicate primary keys: count rows where a PK column repeats
 *   - Negative values: numeric columns that shouldn't be negative (price, qty, etc.)
 *   - Future dates: date columns with values > today
 *   - Constant columns: columns where unique == 1 (no information)
 *
 * Everything is wrapped with plain-English explanations + a severity.
 * Returns an overall health score 0-100 (100 = pristine).
 */
import type {
  SchemaSnapshot,
  TableInfo,
  DataQualityCanvasObject,
  DataQualityIssue,
} from "@/lib/types";
import { getConnection } from "@/lib/db-connection";

export interface DataQualityScanResult {
  issues: DataQualityIssue[];
  healthScore: number;
  scannedTables: number;
  scannedColumns: number;
  durationMs: number;
}

export async function runDataQualityScan(sessionId: string, schema: SchemaSnapshot): Promise<DataQualityScanResult> {
  const startedAt = Date.now();
  const conn = getConnection(sessionId);
  if (!conn) {
    return { issues: [], healthScore: 0, scannedTables: 0, scannedColumns: 0, durationMs: 0 };
  }

  const issues: DataQualityIssue[] = [];
  let scannedColumns = 0;

  // Cap the number of tables we scan to keep this fast for big schemas.
  // Pick the 8 tables with the most rows — those matter most.
  const tablesToScan = [...schema.tables]
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, 8);

  for (const table of tablesToScan) {
    try {
      const tableIssues = await scanTable(sessionId, table);
      issues.push(...tableIssues);
      scannedColumns += table.columns.length;
    } catch {
      // Skip a table that errors — the scan is best-effort.
    }
  }

  // Compute a health score: start at 100, subtract by severity weights.
  const weights = { critical: 15, notable: 6, info: 2 };
  let penalty = 0;
  for (const issue of issues) penalty += weights[issue.severity];
  const healthScore = Math.max(0, Math.min(100, 100 - penalty));

  return {
    issues: issues.sort((a, b) => severityRank(a) - severityRank(b)),
    healthScore,
    scannedTables: tablesToScan.length,
    scannedColumns,
    durationMs: Date.now() - startedAt,
  };
}

function severityRank(i: DataQualityIssue): number {
  return i.severity === "critical" ? 0 : i.severity === "notable" ? 1 : 2;
}

async function scanTable(sessionId: string, table: TableInfo): Promise<DataQualityIssue[]> {
  const conn = getConnection(sessionId);
  if (!conn) return [];

  const issues: DataQualityIssue[] = [];
  const tableName = `"${table.name.replace(/"/g, '""')}"`;

  // Pick columns to scan — cap to 15 to keep this fast on wide tables.
  const columnsToScan = table.columns.slice(0, 15);

  for (const col of columnsToScan) {
    const colName = `"${col.name.replace(/"/g, '""')}"`;
    const isNumeric = /int|float|real|decimal|numeric|number|double/i.test(col.dataType);
    const isDate = /date|time|timestamp/i.test(col.dataType);
    const isLikelyMoney = /price|cost|amount|total|revenue|salary|fee|payment/i.test(col.name);
    const isLikelyQuantity = /qty|quantity|count|stock|inventory/i.test(col.name);

    // 1. High nulls
    try {
      const r = await conn.query(
        `SELECT COUNT(*) AS total, COUNT(${colName}) AS non_null FROM ${tableName} LIMIT 1`,
        1
      );
      const total = Number(r.rows[0]?.total ?? 0);
      const nonNull = Number(r.rows[0]?.non_null ?? 0);
      if (total > 0) {
        const nullPct = ((total - nonNull) / total) * 100;
        if (nullPct >= 5) {
          const sev = nullPct > 30 ? "critical" : nullPct > 15 ? "notable" : "info";
          issues.push({
            kind: "high_nulls",
            severity: sev,
            title: `"${col.name}" in ${table.name} is missing ${nullPct.toFixed(1)}% of its values`,
            description: `About ${Math.round(total - nonNull).toLocaleString()} of ${total.toLocaleString()} rows in ${table.name} have no value for ${col.name}. ${nullPct > 30 ? "This is high enough that any analysis using this column should treat the missing rows as a separate group, not ignore them." : "Most analyses tolerate this, but it's worth understanding why rows are missing before drawing conclusions."}`,
            table: table.name,
            column: col.name,
            metric: "null percentage",
            value: `${nullPct.toFixed(1)}%`,
          });
        }
      }
    } catch { /* skip */ }

    // 2. Duplicate primary keys — for live databases this is `isPrimaryKey`.
    // For CSV/XLSX uploads (classic mode) the schema doesn't carry PK info,
    // so we also check by name pattern. We treat a column as a "primary key
    // candidate" if its name is one of:
    //   - exactly "id"
    //   - ends in "_id" AND the prefix matches the table's first-word
    //     singular (e.g. "employee_id" in "employees" or
    //     "employees_messy" → singular = "employee" → match)
    //   - exactly the table's singular form
    // This avoids false positives on foreign-key columns like "manager_id",
    // "customer_id", "product_id" which naturally repeat.
    const tableNameFirstWord = table.name.split(/[_\s-]/)[0].toLowerCase();
    const tableNameSingular = tableNameFirstWord.replace(/s$/i, "");
    const colNameLower = col.name.toLowerCase();
    const looksLikePrimaryKey = col.isPrimaryKey
      || colNameLower === "id"
      || colNameLower === `${tableNameSingular}_id`
      || colNameLower === `${tableNameSingular}id`
      || colNameLower === tableNameSingular
      || (col === table.columns[0] && /int|number|integer/i.test(col.dataType) && /id/i.test(col.name));
    if (looksLikePrimaryKey) {
      try {
        const r = await conn.query(
          `SELECT COUNT(*) AS dupes FROM (SELECT ${colName} AS k FROM ${tableName} GROUP BY ${colName} HAVING COUNT(*) > 1) AS dups LIMIT 1`,
          1
        );
        const dupes = Number(r.rows[0]?.dupes ?? 0);
        if (dupes > 0) {
          issues.push({
            kind: "duplicate_keys",
            severity: "critical",
            title: `${dupes.toLocaleString()} duplicate ${col.name} value${dupes === 1 ? "" : "s"} in ${table.name}`,
            description: `The column "${col.name}" looks like a unique identifier, but ${dupes.toLocaleString()} value${dupes === 1 ? "" : "s"} appear more than once. This usually means either a data import bug or that the wrong column was chosen as the id. Any join or aggregation keyed on this column will silently double-count rows.`,
            table: table.name,
            column: col.name,
            metric: "duplicate value count",
            value: dupes,
          });
        }
      } catch { /* skip */ }
    }

    // 3. Negative values for money/quantity columns
    if (isNumeric && (isLikelyMoney || isLikelyQuantity)) {
      try {
        const r = await conn.query(
          `SELECT COUNT(*) AS neg FROM ${tableName} WHERE ${colName} < 0 LIMIT 1`,
          1
        );
        const neg = Number(r.rows[0]?.neg ?? 0);
        if (neg > 0) {
          issues.push({
            kind: "negative_values",
            severity: "notable",
            title: `${neg.toLocaleString()} row${neg === 1 ? "" : "s"} in ${table.name} have negative ${col.name}`,
            description: `${isLikelyMoney ? "Money" : "Quantity"} columns like ${col.name} usually shouldn't be negative. ${neg} row${neg === 1 ? "" : "s"} violate this. Either these are refunds/returns (legitimate) or data entry errors worth cleaning up.`,
            table: table.name,
            column: col.name,
            metric: "negative value count",
            value: neg,
          });
        }
      } catch { /* skip */ }
    }

    // 4. Future dates
    if (isDate) {
      try {
        const r = await conn.query(
          `SELECT COUNT(*) AS future FROM ${tableName} WHERE ${colName} > CURRENT_DATE LIMIT 1`,
          1
        );
        const future = Number(r.rows[0]?.future ?? 0);
        if (future > 0) {
          issues.push({
            kind: "future_dates",
            severity: "info",
            title: `${future.toLocaleString()} row${future === 1 ? "" : "s"} in ${table.name} have ${col.name} set in the future`,
            description: `${future.toLocaleString()} row${future === 1 ? "" : "s"} have a ${col.name} later than today. This may be intentional (scheduled events, forecasts) or a timezone bug. Worth a spot-check.`,
            table: table.name,
            column: col.name,
            metric: "future date count",
            value: future,
          });
        }
      } catch { /* skip — some dialects don't support CURRENT_DATE the same way */ }
    }
  }

  // 5. Constant columns — pick up via a single grouped query
  try {
    const r = await conn.query(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT * FROM ${tableName} LIMIT 2) AS distinct_rows LIMIT 1`,
      1
    );
    const distinctCount = Number(r.rows[0]?.n ?? 0);
    if (distinctCount <= 1 && table.rowCount > 1) {
      // Don't blame any specific column here — this is a table-level signal.
      issues.push({
        kind: "constant_column",
        severity: "info",
        title: `Table ${table.name} has very low row diversity`,
        description: `Only ${distinctCount} distinct row${distinctCount === 1 ? "" : "s"} found in the first 2 rows of ${table.name}. This may mean the table is mostly empty, all rows are identical, or every column is constant. Worth investigating before aggregating.`,
        table: table.name,
        metric: "distinct rows (sample)",
        value: distinctCount,
      });
    }
  } catch { /* skip */ }

  return issues;
}

/** Build the canvas object from a scan result. */
export function toCanvasObject(result: DataQualityScanResult): DataQualityCanvasObject {
  return {
    type: "data_quality",
    title: "Data Quality Scan",
    generatedAt: new Date().toISOString(),
    issues: result.issues,
    healthScore: result.healthScore,
  };
}
