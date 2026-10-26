// Owner Home — the chart band's shared primitives.
//
// The band is composed of three panels (Collections/Attendance, Payment
// mix) that all need the same two things: a comparison block that states
// the metric, the change and the exact ranges, and a data table that
// carries the same numbers as the picture. They live here so each panel
// file stays about one panel.

export function ChartComparison({
  label,
  meaning,
  text,
  previousLabel,
  capNote,
}: {
  label: string;
  meaning: string;
  text: string;
  previousLabel: string;
  capNote: string | null;
}) {
  const expansion =
    label === "DoD" ? "day over day" : label === "WoW" ? "week over week" : "month over month";
  return (
    <div
      className="max-w-[46ch] rounded-ctl bg-deck px-3 py-2"
      title={meaning}
      data-testid="chart-comparison"
    >
      <p className="text-[12px] text-ink-2">
        <span className="font-medium">{label}</span>
        <span className="text-ink-3"> · {expansion}</span> — {text}
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-3">vs {previousLabel}</p>
      {capNote ? <p className="mt-0.5 text-[11.5px] text-ink-3">{capNote}</p> : null}
    </div>
  );
}

/**
 * The accessible table behind a chart. The picture is the summary; this
 * is the source, and it is reachable by keyboard on every screen.
 */
export function ChartTable({
  caption,
  head,
  rows,
  total,
  mobile = false,
}: {
  caption: string;
  head: string[];
  rows: string[][];
  total?: string[];
  mobile?: boolean;
}) {
  return (
    <details className={`${mobile ? "lg:hidden" : "hidden lg:block"} mt-2`}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[12.5px] text-ink-2 marker:content-none">
        View data table
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              {head.map((cell) => (
                <th key={cell} scope="col" className="py-1.5 pr-3 font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`} className="border-b border-line/60">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-1.5 pr-3 text-ink-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total ? (
            <tfoot>
              <tr>
                {total.map((cell, index) => (
                  <td key={index} className="py-1.5 pr-3 font-medium text-ink">
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </details>
  );
}

/**
 * The cash/digital/other legend. The colour is data, so the words carry
 * the meaning and the swatch only repeats it.
 */
export function ChartLegend() {
  return (
    <ul
      aria-label="Payment groups"
      className="mt-2 flex flex-wrap items-center text-[12px] text-ink-3"
      style={{ columnGap: 16, rowGap: 4 }}
    >
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" aria-hidden="true" />
        Cash
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" aria-hidden="true" />
        Digital
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[var(--chart-3)]" aria-hidden="true" />
        Other
      </li>
    </ul>
  );
}

/** The compact money figure that opens a panel. */
export function PanelTotal({ amount, suffix }: { amount: string; suffix: string }) {
  return (
    <p className="text-[13px] text-ink-2 tabular-nums">
      <span className="font-display text-[20px] font-semibold text-ink">{amount}</span>{" "}
      {suffix}
    </p>
  );
}

/** The compact money figure with a caption under it (the payment mix). */
export function PanelFigure({ amount }: { amount: string }) {
  return (
    <p className="mt-3 font-display text-[20px] font-semibold tabular-nums">{amount}</p>
  );
}
