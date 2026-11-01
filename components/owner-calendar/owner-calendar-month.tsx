// The shared owner calendar — the month strip.
//
// A compact overview of the month: one cell per day, a count of what
// each day holds, and a link into the week that day belongs to. The
// month is an overview, not a schedule — the day and week views are
// where an event's time and place are read.

import Link from "next/link";

export type CalendarMonthCell = {
  /** yyyy-mm-dd. */
  date: string;
  /** False for the days that pad the first and last weeks. */
  inMonth: boolean;
  /** How many events the day holds. */
  count: number;
};

export function OwnerCalendarMonth({
  cells,
  hrefFor,
}: {
  cells: CalendarMonthCell[];
  /** Where each day opens. */
  hrefFor: (date: string) => string;
}) {
  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3">
      <table className="w-full table-fixed border-collapse text-center">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
              <th key={`${day}-${index}`} className="py-1 font-medium">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk(cells, 7).map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell) => (
                <td key={cell.date} className="p-0.5 align-top">
                  {cell.inMonth ? (
                    <Link
                      href={hrefFor(cell.date)}
                      className={`flex min-h-[44px] flex-col items-center justify-center rounded-ctl text-[13px] ${
                        cell.count > 0 ? "bg-water-soft text-ink" : "text-ink-3"
                      }`}
                    >
                      <span className="tabular-nums">
                        {Number(cell.date.slice(8, 10))}
                      </span>
                      {cell.count > 0 ? (
                        <span className="text-[11px] tabular-nums text-water">
                          {cell.count}
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="block min-h-[44px]" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
