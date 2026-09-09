import * as React from "react";
import { cn } from "@/lib/utils";

// Shared table primitive (UX-002 / BC-051 / BC-125): every data table carries
// an accessible name, complete columnheader semantics, and cell semantics.
// Empty values render explicit text — an empty cell or a "—" placeholder is a
// contract violation, because the reader cannot tell "none" from "missing".

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** Text used when the row has no value for this column. */
  emptyText?: string;
  /** Optional custom rendering; return `undefined` to fall back to value text. */
  render?: (row: Row) => React.ReactNode;
  className?: string;
}

interface DataTableProps<Row> {
  /** Accessible name, rendered as a visually hidden caption. */
  ariaLabel: string;
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  getRowId: (row: Row) => string;
  getValue: (row: Row, columnKey: string) => unknown;
  className?: string;
}

const DEFAULT_EMPTY_TEXT = "未提供";

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function DataTable<Row>({ ariaLabel, columns, rows, getRowId, getValue, className }: DataTableProps<Row>) {
  return (
    <div className={cn("overflow-x-auto rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-sm" role="table" aria-label={ariaLabel}>
        <caption className="sr-only">{ariaLabel}</caption>
        <thead>
          <tr className="border-b border-border bg-secondary/60 text-left">
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-3 text-muted-foreground">
                没有可显示的记录
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowId(row)} className="border-b border-border last:border-b-0">
                {columns.map((column) => {
                  const custom = column.render?.(row);
                  const value = custom === undefined || custom === null ? getValue(row, column.key) : custom;
                  return (
                    <td key={column.key} className={cn("px-3 py-2 align-top", column.className)}>
                      {isEmptyValue(value) ? (column.emptyText ?? DEFAULT_EMPTY_TEXT) : String(value)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
