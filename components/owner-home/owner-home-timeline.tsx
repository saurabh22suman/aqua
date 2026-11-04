import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  nextUpcomingIndex,
  occupancy,
  sessionStateFor,
  type TodaysLaneDisplay,
} from "@/components/owner-home/session-state";
import { formatWallTime12h, formatWeekdayDateIST } from "@/lib/time/tz";
import type { NextClass, TodaysLane } from "@/lib/services/dashboard";

// Owner Home — the day's sessions, as the approved mock draws them.
//
// One clean row per session: the TIME on the left, the class with a
// READABLE coach/facility line in the middle, and one compact soft state
// pill on the right. The row states what is TRUE:
//
//   * the pill is the session's CLOCK state — Scheduled / Starts in N /
//     Scheduled now / Earlier today — or its real lifecycle status
//     (Completed / Cancelled) when the read model actually carries one;
//   * a legacy row without timestamps falls back to Scheduled / Started
//     from the existing `started` flag;
//   * "Scheduled now" means the session's clock window, never recorded
//     attendance, and register completion is never shown as progress;
//   * over-capacity is still SAID (a late-tone line), it is simply no
//     longer drawn as a bar.
//
// The mock's copy is preserved: a quiet "Open calendar" link, a bounded
// list (the rest behind a native disclosure), and the next class when the
// day is quiet.

const MAX_VISIBLE_ROWS = 3;

/** "Coach · Facility" when the facility is real; otherwise what is known. */
function laneMeta(lane: TodaysLaneDisplay): string | null {
  const parts = [lane.coachName, lane.locationName].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(" · ");
  return lane.programName || null;
}

/** The instant as the academy's own wall clock, "HH:MM" (Asia/Kolkata). */
function instantWallIST(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return hour && minute ? `${hour}:${minute}` : "";
}

/**
 * The row's TIME is the SESSION's own start when the read supplies one — a
 * rescheduled session can differ from its batch's default wall time, and the
 * time and the state pill must describe the same actual session. The batch's
 * default remains the truthful fallback for a legacy row without a real start.
 */
function laneTime(lane: TodaysLaneDisplay): string {
  if (lane.startsAt) {
    const instant = new Date(lane.startsAt);
    if (!Number.isNaN(instant.getTime())) {
      const wall = instantWallIST(instant);
      if (wall) return formatWallTime12h(wall);
    }
  }
  return formatWallTime12h(lane.startTime);
}

/** The quiet-day next class: its REAL instant when valid, else its wall time. */
function nextClassTime(nextClass: NextClass): string {
  const instant =
    nextClass.startsAt instanceof Date
      ? nextClass.startsAt
      : new Date(nextClass.startsAt);
  if (!Number.isNaN(instant.getTime())) {
    const wall = instantWallIST(instant);
    if (wall) return formatWallTime12h(wall);
  }
  return formatWallTime12h(nextClass.startTime);
}

export function OwnerHomeTimeline({
  lanes,
  scheduleHref,
  nextClass,
  sessionsLabel,
  sessionLabel,
  coachLabel,
}: {
  lanes: readonly TodaysLane[];
  scheduleHref: string | null;
  nextClass: NextClass | null;
  sessionsLabel: string;
  sessionLabel: string;
  coachLabel: string;
}) {
  const nextIndex = nextUpcomingIndex(lanes);
  const sessionCount = lanes.length;
  const visible = lanes.slice(0, MAX_VISIBLE_ROWS);
  const folded = lanes.slice(MAX_VISIBLE_ROWS);
  const nextLane = nextIndex >= 0 ? lanes[nextIndex] : null;
  // The up-next session is folded away: the disclosure says which one,
  // in plain words (no chip).
  const nextIsFolded = nextIndex >= MAX_VISIBLE_ROWS && nextLane !== null;

  return (
    <section data-testid="owner-home-today" aria-label="Your club today" className="rounded-card border border-line bg-paper">
      <div className="px-4 pt-4">
        <SectionHeader
          title="Today’s sessions"
          trailing={
            scheduleHref ? (
              <Link
                href={scheduleHref}
                className="inline-flex min-h-11 items-center text-[12.5px] font-medium text-[var(--accent-ink)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                Open calendar
              </Link>
            ) : undefined
          }
        />
      </div>

      {sessionCount === 0 ? (
        <div className="px-4 pb-4">
          {nextClass ? (
            <>
              <p className="text-[13.5px] font-medium">Next: {nextClass.batchName}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                {formatWeekdayDateIST(nextClass.sessionDate)} at{" "}
                {nextClassTime(nextClass)}
                {nextClass.coachName
                  ? ` · ${nextClass.coachName}`
                  : ` · no ${coachLabel} assigned`}
              </p>
            </>
          ) : (
            <p className="text-[13.5px] font-medium">
              Nothing scheduled today, and no class booked ahead.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <ul>
            {visible.map((lane) => (
              <SessionRow key={lane.sessionId} lane={lane} />
            ))}
          </ul>
          {folded.length > 0 ? (
            <details data-testid="owner-home-today-more" className="border-t border-line">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-1.5 px-4 py-2.5 text-[12.5px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
                {folded.length} more {folded.length === 1 ? sessionLabel : sessionsLabel}
                {nextIsFolded && nextLane ? (
                  <span className="font-normal text-ink-3">
                    — up next {nextLane.batchName} at {laneTime(nextLane as TodaysLaneDisplay)}
                  </span>
                ) : null}
              </summary>
              <ul>
                {folded.map((lane) => (
                  <SessionRow key={lane.sessionId} lane={lane} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * One session row: time · class + readable coach/facility · soft state pill.
 *
 * ABOVE ~360px the three parts sit on one line (time | details | pill).
 * On a NARROW phone the row REFLOWS instead of squeezing the title between
 * the fixed time and the pill: the title column keeps a useful minimum
 * (120px) and the pill drops to the end of the next line, below the details.
 * Nothing is truncated or hidden and the type does not shrink. (Measured in
 * real Chrome: the old fixed columns left the title ~77px at 320px.)
 *
 * The occupancy is still COMPUTED so an over-capacity batch is still SAID;
 * it is no longer drawn as a bar.
 */
function SessionRow({ lane }: { lane: TodaysLane }) {
  const display = lane as TodaysLaneDisplay;
  const state = sessionStateFor(display);
  const fill = occupancy(lane);
  const meta = laneMeta(display);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line px-4 py-3 first:border-t-0">
      <time className="w-[4.5rem] shrink-0 pt-0.5 text-[12.5px] tabular-nums text-ink-2">
        {laneTime(display)}
      </time>
      <div className="min-w-[120px] flex-1">
        <p className="text-[15px] font-medium leading-snug">{lane.batchName}</p>
        {meta ? (
          <p data-testid="session-meta" className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
            {meta}
          </p>
        ) : null}
        {fill.overBy > 0 ? (
          <p className="mt-0.5 text-[12px] font-medium text-ink-2">Over capacity</p>
        ) : null}
      </div>
      <span data-testid="session-state-pill" className="ml-auto shrink-0">
        <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
      </span>
    </li>
  );
}
