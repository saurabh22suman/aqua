// 30 October 2026 — the accessible data table behind a report chart.
//
// A chart may show a shape; the numbers behind it have to be readable
// as numbers, by keyboard and by touch, without hovering anything.
// This is that table: a keyboard-reachable summary, a labelled scroll
// region, a caption for screen readers and the exact values.
//
// It is deliberately a plain server component. There is no client
// island, no chart library and no hover-only value: the same figures
// are in the table and in the chart's own tooltip.

export type ReportTableColumn = {
  label: string;
  /** Numeric columns are right aligned and set in the money face. */
  numeric?: boolean;
};

export function ReportDataTable({
  summaryLabel,
  regionLabel,
  caption,
  columns,
  rows,
}: {
  summaryLabel: string;
  regionLabel: string;
  caption: string;
  columns: ReportTableColumn[];
  rows: string[][];
}) {
  return (
    <details className="mt-2 rounded-ctl border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-[var(--accent-ink)]">
        {summaryLabel}
      </summary>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={regionLabel}
      >
        <table className="w-full text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {columns.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={
                    column.numeric
                      ? "px-3 py-2 text-right font-medium"
                      : "px-3 py-2 font-medium"
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0] ?? ""} className="border-b border-line last:border-0">
                {row.map((cell, index) => (
                  <td
                    key={`${row[0] ?? ""}-${index}`}
                    className={
                      index === 0
                        ? "px-3 py-2 text-ink-2"
                        : "px-3 py-2 text-right font-mono tabular-nums text-ink"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
