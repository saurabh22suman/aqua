import { ChevronDown } from "lucide-react";
import type {
  AttendanceByBatchInsight,
  AttendanceByBatchRow,
} from "@/lib/services/owner-insights";

// How many batch rows the detail shows before the owner asks for the
// rest. A phone cannot usefully read seven of them, and a wall of rows
// is what the independent review of the first delivery flagged.
//
// The bound is on the ROWS only. Every total and denominator in this
// block keeps describing the FULL scoped result, so the numbers never
// change when the rest is revealed.
const INITIAL_ROWS = 3;

const PRESENT = "bg-[var(--chart-1)]";
const LATE = "bg-[var(--chart-2)]";
const ABSENT = "bg-[var(--chart-3)]";

export function AttendanceByBatch({
  insight,
}: {
  insight: AttendanceByBatchInsight;
}) {
  if (insight.rows.length === 0) {
    return (
      <p className="text-[13px] text-ink-3">
        No batch ran a session in this window, so there is nothing to show.
      </p>
    );
  }

  const { rows, summary } = insight;
  const shown = rows.slice(0, INITIAL_ROWS);
  const rest = rows.slice(INITIAL_ROWS);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-[14px] font-semibold">
          Attendance by batch
        </h3>
        <p className="text-[12px] text-ink-3">
          {rows.length} {rows.length === 1 ? "batch" : "batches"} ·{" "}
          {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"} ·{" "}
          {summary.marks.total} marks recorded
        </p>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" aria-hidden="true" />
          Present
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" aria-hidden="true" />
          Late
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--chart-3)]" aria-hidden="true" />
          Absent
        </li>
      </ul>

      {rest.length > 0 ? (
        <p className="mt-2 text-[11.5px] text-ink-3">
          Showing the first {shown.length} of {rows.length} batches, in name order.
        </p>
      ) : null}

      <ul data-testid="owner-insights-batch-list" className="mt-2 space-y-3">
        {shown.map((row) => (
          <BatchRow key={row.batchId} row={row} />
        ))}
      </ul>

      {rest.length > 0 ? (
        // A native disclosure: it opens and closes from the keyboard
        // without a line of JavaScript, and its content is in the
        // HTML for a reader who never runs any.
        <details
          data-testid="owner-insights-more-batches"
          className="group/inner mt-1"
        >
          <summary
            className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <span className="group-open/inner:hidden">
              Show all {rows.length} batches
            </span>
            <span className="hidden group-open/inner:inline">Show fewer</span>
            <ChevronDown
              size={14}
              className="text-ink-3 transition-transform group-open/inner:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <ul className="space-y-3 pb-1">
            {rest.map((row) => (
              <BatchRow key={row.batchId} row={row} />
            ))}
          </ul>
        </details>
      ) : null}

      <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-3">
        <li>
          Shares are of the marks recorded. A member with no mark is unknown,
          never absent.
        </li>
        <li>
          Only sessions that had members enrolled count. A session is fully
          marked when everyone enrolled by that day has a mark.
        </li>
        <li>
          Cancelled sessions are not counted — a cancelled session is not a
          chance to attend. The attendance report counts them too, so its
          session totals can differ.
        </li>
      </ul>
    </div>
  );
}

/**
 * One batch.
 *
 * The name WRAPS rather than being cut off: a batch whose name is
 * shortened on a phone is a batch the owner cannot recognise, and the
 * programme it belongs to matters as much as the name.
 */
function BatchRow({ row }: { row: AttendanceByBatchRow }) {
  const { marks, register } = row;
  const presentOrLate = marks.present + marks.late;
  return (
    <li data-testid="owner-insights-batch-row">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 break-words text-[13.5px] font-medium">
          {row.batchName}
          {row.programName ? (
            <span className="font-normal text-ink-3"> · {row.programName}</span>
          ) : null}
        </p>
        <span className="flex-none text-[12px] text-ink-3">
          {row.sessions} {row.sessions === 1 ? "session" : "sessions"}
        </span>
      </div>

      {marks.total > 0 ? (
        <div
          className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-pill bg-deck"
          aria-hidden="true"
        >
          {marks.present > 0 ? (
            <span className={PRESENT} style={{ flexGrow: marks.present, flexBasis: 0 }} />
          ) : null}
          {marks.late > 0 ? (
            <span className={LATE} style={{ flexGrow: marks.late, flexBasis: 0 }} />
          ) : null}
          {marks.absent > 0 ? (
            <span className={ABSENT} style={{ flexGrow: marks.absent, flexBasis: 0 }} />
          ) : null}
        </div>
      ) : null}

      <p className="mt-1 text-[11.5px] text-ink-3">
        {marks.total > 0
          ? `${presentOrLate} of ${marks.total} marks present or late`
          : "No marks recorded — unknown, not 0%"}
        {register.sessionsWithRoster > 0
          ? ` · ${register.completedRegisters} of ${register.sessionsWithRoster} ${
              register.sessionsWithRoster === 1 ? "session" : "sessions"
            } fully marked`
          : null}
      </p>
    </li>
  );
}
