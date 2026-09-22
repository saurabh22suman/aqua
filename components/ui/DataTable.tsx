import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

// PR3-C2 — desktop table. Renders a real <table> at md+ and the
// caller's mobile representation below it, so a list screen can scan
// on desktop without giving up the card layout on a phone. The table
// only renders rows it is given — empty is the caller's EmptyState.
export type DataTableColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  testId = "data-table",
}: {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  testId?: string;
}) {
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }

  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`py-2 font-medium ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-t border-line ${
                onRowClick ? "cursor-pointer hover:bg-deck/60" : ""
              }`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`py-2.5 ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
