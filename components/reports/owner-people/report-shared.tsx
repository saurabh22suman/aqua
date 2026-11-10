import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ColumnChart } from "@/components/charts/report-column-chart";
import { addDays, formatDateIST } from "@/lib/time/tz";
import type { OwnerPeriodKey } from "@/lib/time/owner-periods";

export function RangeFilter({ period, facility }: { period: OwnerPeriodKey; facility?: string }) {
  return <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
    <label className="min-w-40 flex-1 text-sm font-medium">Range
      <Select name="period" defaultValue={period}>
        <option value="last7">Last 7 days</option><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option>
      </Select>
    </label>
    {facility ? <input type="hidden" name="facility" value={facility} /> : null}
    <Button type="submit" variant="secondary" size="md">Apply</Button>
  </form>;
}

export function daysBetween(from: string, to: string): string[] {
  const result: string[] = [];
  for (let date = from; date <= to && result.length < 32; date = addDays(date, 1)) result.push(date);
  return result;
}

export function DailyChart({ title, emptyMessage, days, values }: { title: string; emptyMessage: string; days: string[]; values: Map<string, number> }) {
  const points = days.map((day) => ({ label: day, hint: formatDateIST(day), value: values.get(day) ?? 0 }));
  const hasRecords = points.some((point) => point.value > 0);
  return <section className="mt-4 rounded-card border border-line bg-paper p-4">
    <h2 className="font-display text-lg font-semibold">{title}</h2>
    {hasRecords ? <div className="mt-3"><ColumnChart points={points} ariaLabel={title} /></div> : <p className="mt-2 text-sm text-ink-2">{emptyMessage}</p>}
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 font-medium">View data</summary>
      <table className="mt-3 w-full text-left text-sm"><thead><tr><th>Date</th><th>Count</th></tr></thead>
        <tbody>{days.map((day) => <tr key={day}><td className="py-1">{formatDateIST(day)}</td><td>{values.get(day) ?? 0}</td></tr>)}</tbody></table>
    </details>
  </section>;
}

/**
 * Horizontal status bars for a CURRENT snapshot.
 *
 * The same counts the old text list showed, drawn as one row per status with
 * a full accessible label ("active: 42") and the exact number visible. The
 * palette is the theme accent for every status: membership or attendance
 * states are not financial alarms and must not borrow alarm colours.
 */
export function StatusBars({ title, rows, emptyMessage, note }: {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
  emptyMessage: string;
  note?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <section data-testid="status-bars" className="mt-4 rounded-card border border-line bg-paper p-4">
    <h2 className="font-display text-lg font-semibold">{title}</h2>
    {rows.length ? (
      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.key} data-status={row.key} role="img" aria-label={`${row.label}: ${row.count}`}
            className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 break-words text-[14px] font-medium capitalize text-ink">{row.label}</span>
              <span className="flex-none text-[13px] tabular-nums text-ink-2">{row.count}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-pill bg-deck">
              <span className="block h-full rounded-pill bg-[var(--accent-strong)]" style={{ width: `${total ? Math.round((row.count / total) * 100) : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    ) : <p className="mt-2 text-sm text-ink-2">{emptyMessage}</p>}
    {note ? <p className="mt-3 text-sm text-ink-3">{note}</p> : null}
  </section>;
}
