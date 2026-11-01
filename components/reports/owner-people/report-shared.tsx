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
