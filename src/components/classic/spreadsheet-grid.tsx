"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Loader2, Plus, Trash2, Columns3, Pencil, Check, X,
  RefreshCw, Table2, FileSpreadsheet, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface GridData {
  columns: { name: string; dtype?: string }[];
  rows: Record<string, unknown>[];
  totalRows: number;
  table: string;
}

interface TableMeta {
  name: string;
  rowCount: number;
  columns: { name: string; dtype?: string }[];
  profile?: {
    columns: {
      name: string;
      dtype: string;
      nulls: number;
      nullPct: number;
      unique: number;
      min?: number | null;
      max?: number | null;
      mean?: number | null;
      topValues?: { value: string; count: number }[];
    }[];
    rowCount: number;
  };
}

interface EditState {
  rowIndex: number;
  column: string;
  value: string;
}

/**
 * SpreadsheetGrid — Excel-like editable grid for SelectStar Classic.
 *
 * Multi-table workspace: shows a table picker at the top. Each uploaded
 * file (or XLSX sheet) is a separate table. The agent can JOIN across them;
 * the user can edit any of them.
 *
 * Layout:
 *   ┌─ table picker ──────────────────────────────────────────┐
 *   │ [Table 1] [Table 2] [Table 3]              Refresh + Row │
 *   ├─ toolbar: cols · rows · profile button ────────────────┤
 *   │  header row: renameable columns + delete buttons        │
 *   │  data rows: editable cells + delete-row buttons         │
 *   └─────────────────────────────────────────────────────────┘
 */
export function SpreadsheetGrid({ sessionId }: { sessionId: string }) {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [data, setData] = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const zenMode = useSession((s) => s.zenMode);

  // Load the list of tables first.
  const loadTables = useCallback(async () => {
    try {
      const res = await fetch(`/api/classic/data?sessionId=${encodeURIComponent(sessionId)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load tables");
      const tlist: TableMeta[] = d.tables || [];
      setTables(tlist);
      // Pick the first table if none is active, or keep the current one if it still exists.
      if (!activeTable || !tlist.some((t) => t.name === activeTable)) {
        setActiveTable(tlist[0]?.name ?? null);
      }
      return tlist;
    } catch (e) {
      toast.error((e as Error).message);
      return [];
    }
  }, [sessionId, activeTable]);

  // Load rows for the active table.
  const reload = useCallback(async () => {
    if (!activeTable) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/classic/data?sessionId=${encodeURIComponent(sessionId)}&table=${encodeURIComponent(activeTable)}&limit=1000`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load data");
      setData(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, activeTable]);

  useEffect(() => { void loadTables(); }, [loadTables]);
  useEffect(() => { void reload(); }, [reload]);

  function startEdit(rowIndex: number, column: string, currentValue: unknown) {
    if (!zenMode) { toast.error("Enable Zen mode above to edit the spreadsheet directly."); return; }
    if (!activeTable) return;
    setEdit({ rowIndex, column, value: currentValue === null || currentValue === undefined ? "" : String(currentValue) });
  }

  async function commitEdit() {
    if (!edit || !activeTable) return;
    setPendingCell(`${edit.rowIndex}:${edit.column}`);
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "setCell", rowIndex: edit.rowIndex, column: edit.column, value: edit.value }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Edit failed");
      setData((prev) => {
        if (!prev) return prev;
        const rows = prev.rows.map((r, i) =>
          i === edit.rowIndex ? { ...r, [edit.column]: coerceLocal(edit.value, prev.columns.find((c) => c.name === edit.column)?.dtype) } : r
        );
        return { ...prev, rows };
      });
    } catch (e) { toast.error((e as Error).message); }
    finally { setPendingCell(null); setEdit(null); }
  }

  function cancelEdit() { setEdit(null); }

  async function addRow() {
    if (!zenMode) { toast.error("Enable Zen mode to add rows."); return; }
    if (!activeTable) return;
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "addRow" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Add row failed");
      await reload();
      await loadTables();
      toast.success("Row added.");
    } catch (e) { toast.error((e as Error).message); }
  }

  async function deleteRow(rowIndex: number) {
    if (!zenMode) { toast.error("Enable Zen mode to delete rows."); return; }
    if (!activeTable) return;
    if (!confirm(`Delete row ${rowIndex + 1} from "${activeTable}"?`)) return;
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "deleteRow", rowIndex }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delete failed");
      await reload();
      await loadTables();
      toast.success("Row deleted.");
    } catch (e) { toast.error((e as Error).message); }
  }

  function startRenameColumn(name: string) {
    if (!zenMode) { toast.error("Enable Zen mode to rename columns."); return; }
    setRenamingCol(name); setRenameValue(name);
  }

  async function commitRenameColumn() {
    if (!renamingCol || !activeTable) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingCol) { setRenamingCol(null); return; }
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "renameColumn", oldName: renamingCol, newName }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Rename failed");
      await reload();
      await loadTables();
      toast.success(`Column renamed to "${newName}".`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setRenamingCol(null); }
  }

  async function addColumn() {
    if (!activeTable) return;
    const name = newColName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "addColumn", name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Add column failed");
      await reload();
      await loadTables();
      setNewColName(""); setAddingCol(false);
      toast.success(`Column "${name}" added.`);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function deleteColumn(name: string) {
    if (!zenMode) { toast.error("Enable Zen mode to delete columns."); return; }
    if (!activeTable) return;
    if (!confirm(`Delete column "${name}" from "${activeTable}"?`)) return;
    try {
      const res = await fetch("/api/classic/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, table: activeTable, op: "deleteColumn", name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delete column failed");
      await reload();
      await loadTables();
      toast.success(`Column "${name}" deleted.`);
    } catch (e) { toast.error((e as Error).message); }
  }

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading workspace…
      </div>
    );
  }
  if (!tables.length) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No tables in this workspace.</div>;
  }

  const activeMeta = tables.find((t) => t.name === activeTable);

  return (
    <div className="flex flex-col h-full">
      {/* Table picker — horizontal scrollable strip of table tabs */}
      <div className="flex items-center gap-1 px-3 h-10 border-b border-border bg-muted/30 shrink-0 overflow-x-auto">
        <FileSpreadsheet className="h-3.5 w-3.5 text-primary shrink-0" />
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => { setActiveTable(t.name); setEdit(null); }}
            className={cn(
              "shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
              activeTable === t.name
                ? "bg-background border border-primary/40 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent"
            )}
            title={`${t.rowCount.toLocaleString()} rows · ${t.columns.length} cols`}
          >
            <Table2 className="h-3 w-3" />
            {t.name}
            <span className="text-[9px] text-muted-foreground/70 ml-0.5">{t.rowCount.toLocaleString()}</span>
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs shrink-0" onClick={() => { void loadTables(); void reload(); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Toolbar for the active table */}
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-border bg-background shrink-0">
        <span className="text-xs font-medium">
          {activeMeta?.columns.length ?? 0} cols · {activeMeta?.rowCount.toLocaleString() ?? 0} rows
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" disabled={!zenMode} onClick={() => void addRow()} title={!zenMode ? "Enable Zen mode to edit" : "Append a new row"}>
          <Plus className="h-3 w-3" /> Row
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" disabled={!zenMode} onClick={() => setAddingCol(true)} title={!zenMode ? "Enable Zen mode to edit" : "Add a new column"}>
          <Columns3 className="h-3 w-3" /> Column
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => setShowProfile((v) => !v)} title="Toggle data profile panel">
          <ChevronDown className={cn("h-3 w-3 transition-transform", showProfile && "rotate-180")} /> Profile
        </Button>
        <div className="flex-1" />
        {!zenMode && (
          <span className="text-[10px] text-muted-foreground italic">Read-only — enable Zen mode to edit cells.</span>
        )}
      </div>

      {/* Data profile panel (collapsible) */}
      {showProfile && activeMeta?.profile && (
        <div className="border-b border-border bg-muted/20 px-3 py-2 max-h-48 overflow-y-auto shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">Data profile · {activeMeta.profile.rowCount.toLocaleString()} rows</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {activeMeta.profile.columns.map((c) => (
              <div key={c.name} className="rounded border border-border bg-card px-2 py-1.5 text-[10px]">
                <div className="font-mono font-medium text-foreground">{c.name} <span className="text-muted-foreground/60 uppercase">{c.dtype}</span></div>
                <div className="text-muted-foreground mt-0.5">
                  {c.nullPct.toFixed(1)}% null · {c.unique} unique
                  {c.mean !== undefined && c.mean !== null && (
                    <> · min {c.min} · mean {Math.round(c.mean * 100) / 100} · max {c.max}</>
                  )}
                </div>
                {c.topValues && c.topValues.length > 0 && c.dtype !== "number" && (
                  <div className="text-muted-foreground/70 mt-0.5 truncate">
                    top: {c.topValues.slice(0, 3).map((v) => `${v.value}×${v.count}`).join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The spreadsheet itself */}
      <div className="flex-1 overflow-auto min-h-0">
        {data ? (
        <table className="w-max min-w-full border-collapse text-xs table-fixed">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/40 border-b border-border">
              <th className="w-10 px-2 py-2 text-left text-[10px] font-medium text-muted-foreground border-r border-border">#</th>
              {data.columns.map((c) => (
                <th key={c.name} className="px-2 py-2 text-left font-medium border-r border-border w-40 group relative">
                  {renamingCol === c.name ? (
                    <div className="flex items-center gap-1">
                      <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void commitRenameColumn(); if (e.key === "Escape") setRenamingCol(null); }}
                        className="h-6 text-xs" />
                      <button onClick={() => void commitRenameColumn()} className="text-emerald-500 hover:text-emerald-600"><Check className="h-3 w-3" /></button>
                      <button onClick={() => setRenamingCol(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="truncate flex-1">{c.name}</span>
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60 font-normal">{c.dtype || "?"}</span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                        <button onClick={() => startRenameColumn(c.name)} className="text-muted-foreground hover:text-primary p-0.5" title="Rename column" disabled={!zenMode}><Pencil className="h-2.5 w-2.5" /></button>
                        <button onClick={() => void deleteColumn(c.name)} className="text-muted-foreground hover:text-destructive p-0.5" title="Delete column" disabled={!zenMode}><Trash2 className="h-2.5 w-2.5" /></button>
                      </div>
                    </div>
                  )}
                </th>
              ))}
              {addingCol && (
                <th className="px-2 py-2 text-left border-r border-border w-48">
                  <div className="flex items-center gap-1">
                    <Input autoFocus placeholder="column name" value={newColName} onChange={(e) => setNewColName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void addColumn(); if (e.key === "Escape") { setAddingCol(false); setNewColName(""); } }}
                      className="h-6 text-xs" />
                    <button onClick={() => void addColumn()} className="text-emerald-500 hover:text-emerald-600"><Check className="h-3 w-3" /></button>
                    <button onClick={() => { setAddingCol(false); setNewColName(""); }} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  </div>
                </th>
              )}
              <th className="w-10 px-2 py-2 sticky right-0 bg-muted/60 border-l border-border">
                {!addingCol && zenMode && (
                  <button onClick={() => setAddingCol(true)} className="text-muted-foreground hover:text-primary mx-auto block" title="Add column"><Plus className="h-3 w-3" /></button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/60 hover:bg-accent/20 group">
                <td className="w-10 px-2 py-1.5 text-[10px] text-muted-foreground border-r border-border text-right tabular-nums">{ri + 1}</td>
                {data.columns.map((c) => {
                  const isEditing = edit?.rowIndex === ri && edit?.column === c.name;
                  const cellValue = row[c.name];
                  return (
                    <td key={c.name}
                      className={cn(
                        "px-2 py-1.5 border-r border-border w-40 relative",
                        isEditing ? "p-0" : "cursor-text",
                        cellValue === null || cellValue === undefined || cellValue === "" ? "text-muted-foreground/40 italic" : ""
                      )}
                      onDoubleClick={() => !isEditing && startEdit(ri, c.name, cellValue)}>
                      {isEditing ? (
                        <input autoFocus value={edit!.value}
                          onChange={(e) => setEdit({ ...edit!, value: e.target.value })}
                          onBlur={() => void commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void commitEdit(); }
                            if (e.key === "Escape") cancelEdit();
                            if (e.key === "Tab") {
                              e.preventDefault(); void commitEdit();
                              const ci = data.columns.findIndex((cc) => cc.name === c.name);
                              if (ci < data.columns.length - 1) {
                                  setTimeout(() => startEdit(ri, data.columns[ci + 1].name, row[data.columns[ci + 1].name]), 0);
                              }
                            }
                          }}
                          disabled={pendingCell === `${ri}:${c.name}`}
                          className={cn("w-full h-full px-2 py-1.5 bg-background border-2 border-primary outline-none text-xs font-mono", pendingCell === `${ri}:${c.name}` && "opacity-60")} />
                      ) : (
                        <span className="block truncate">
                          {cellValue === null || cellValue === undefined || cellValue === ""
                            ? "NULL"
                            : typeof cellValue === "object"
                              ? JSON.stringify(cellValue)
                              : String(cellValue)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="w-10 px-2 py-1.5 sticky right-0 bg-background border-l border-border">
                  <button onClick={() => void deleteRow(ri)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mx-auto block" title="Delete row" disabled={!zenMode}><Trash2 className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><td colSpan={data.columns.length + 2} className="px-4 py-12 text-center text-xs text-muted-foreground">No rows. Click "+ Row" to add one.</td></tr>
            )}
          </tbody>
        </table>
        ) : null}
      </div>

      <div className="px-3 py-1.5 border-t border-border bg-background shrink-0 text-[10px] text-muted-foreground/70 flex items-center justify-between">
        <span>Double-click a cell to edit {zenMode ? "· Enter to commit · Tab moves right · Esc cancels" : "· Enable Zen mode first"}</span>
        <span className="tabular-nums">{data?.rows.length ?? 0} shown{data && data.totalRows > data.rows.length ? ` of ${data.totalRows.toLocaleString()}` : ""}</span>
      </div>
    </div>
  );
}

function coerceLocal(value: string, dtype?: string): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (dtype === "number") { const n = Number(value); return Number.isNaN(n) ? value : n; }
  if (dtype === "boolean") {
    if (/^(true|yes|1)$/i.test(value)) return 1;
    if (/^(false|no|0)$/i.test(value)) return 0;
    return value;
  }
  return value;
}
