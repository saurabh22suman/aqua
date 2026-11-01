import Link from "next/link";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  nextUpcomingIndex,
  occupancy,
  placesBooked,
  registerState,
  type RegisterTone,
} from "@/components/owner-home/session-state";
import { formatWallTime12h, formatWeekdayDateIST } from "@/lib/time/tz";
import type { NextClass, TodaysLane } from "@/lib/services/dashboard";

// Owner Home — the day's sessions.
//
// The approved board draws the day as a TIMELINE: the time, the class,
// the places taken, and where the class is right now. Every one of
// those is a real read.
//
// The current/next distinction is the careful part. A session that has
// started is not necessarily still running, so this screen never says
// "in progress" on the strength of a clock — it says that only when the
// register says so (marks recorded, roster not yet complete). The
// session that has not started yet and comes first is marked "Up
// next", and no other session is.
//
// A long day is BOUNDED, not truncated. A club with six sessions in a
// day used to print six rows on a phone, pushing the charts far below
// the fold. The first three rows are printed; the rest stay reachable
// in a native disclosure — no JavaScript, no data loss — and the
// disclosure's control NAMES the up-next session when that session is
// one of the folded ones, so the owner never loses the one thing they
// most need to know about the rest of the day.
//
// A quiet day is not an empty block: it names the next class, with its
// coach, its date, its time and its occupancy.

// How many session rows are printed before the rest are folded away.
const MAX_VISIBLE_ROWS = 3;

export function OwnerHomeTimeline({
  lanes,
  marked,
  enrolled,
  membersLabel,
  coachLabel,
  sessionsLabel,
  sessionLabel,
  registerToneClass,
  scheduleHref,
  nextClass,
}: {
  lanes: readonly TodaysLane[];
  /** Marks recorded across the day. */
  marked: number;
  /** Swimmers expected across the day. */
  enrolled: number;
  /** The word the academy uses for a member. */
  membersLabel: string;
  /** The word the academy uses for a coach. */
  coachLabel: string;
  /** The word the academy uses for a session. */
  sessionsLabel: string;
  /** The academy's singular term for one session. */
  sessionLabel: string;
  /** Maps a register tone onto its colour class (see session-state). */
  registerToneClass: (tone: RegisterTone) => string;
  /** Where "Full schedule" goes, when the caller may open it. */
  scheduleHref: string | null;
  /** The next class after now, on any day. */
  nextClass: NextClass | null;
}) {
  const nextIndex = nextUpcomingIndex(lanes);
  const places = placesBooked(lanes);
  const sessionCount = lanes.length;
  const visible = lanes.slice(0, MAX_VISIBLE_ROWS);
  const folded = lanes.slice(MAX_VISIBLE_ROWS);
  const nextLane = nextIndex >= 0 ? lanes[nextIndex] : null;
  // The up-next session is one of the folded ones — the disclosure has
  // to say which, because its row is not on screen.
  const nextIsFolded = nextIndex >= MAX_VISIBLE_ROWS && nextLane !== null;

  return (
    <section data-testid="owner-home-today" aria-label="Your club today" className="rounded-card border border-line bg-paper p-4">
      <SectionHeader
        className="mb-3"
        title="Today’s sessions"
        subtitle={
          sessionCount === 0
            ? "Nothing scheduled today"
            : enrolled > 0
              ? `${marked} of ${enrolled} marked across ${sessionCount} ${
                  sessionCount === 1 ? "session" : "sessions"
                }`
              : `${sessionCount} ${sessionsLabel} scheduled · no ${membersLabel} enrolled yet`
        }
        trailing={
          scheduleHref ? (
            <Link
              href={scheduleHref}
              className="inline-flex min-h-[36px] items-center text-[12px] font-medium text-[var(--accent-ink)]"
            >
              Full schedule →
            </Link>
          ) : undefined
        }
      />

      {sessionCount === 0 ? (
        <div className="py-2">
          {nextClass ? (
            <>
              <p className="text-[13.5px] font-medium">Next: {nextClass.batchName}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                {formatWeekdayDateIST(nextClass.sessionDate)} at{" "}
                {formatWallTime12h(nextClass.startTime)}
                {nextClass.coachName
                  ? ` · ${nextClass.coachName}`
                  : ` · no ${coachLabel} assigned`}{" "}
                · {nextClass.enrolled} of {nextClass.capacity} enrolled
              </p>
            </>
          ) : (
            <p className="text-[13.5px] font-medium">
              Nothing scheduled today, and no class booked ahead.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden">
          <ul>
            {visible.map((lane, index) => (
              <SessionRow
                key={lane.sessionId}
                lane={lane}
                index={index}
                isNext={index === nextIndex}
                coachLabel={coachLabel}
                registerToneClass={registerToneClass}
              />
            ))}
          </ul>
          {folded.length > 0 ? (
            <details
              data-testid="owner-home-today-more"
              className="border-t border-line"
            >
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
                {folded.length} more {folded.length === 1 ? sessionLabel : sessionsLabel}
                {nextIsFolded && nextLane ? (
                  <span className="font-normal text-ink-3">
                    — up next {nextLane.batchName} at{" "}
                    {formatWallTime12h(nextLane.startTime)}
                  </span>
                ) : null}
              </summary>
              <ul>
                {folded.map((lane, index) => (
                  <SessionRow
                    key={lane.sessionId}
                    lane={lane}
                    index={MAX_VISIBLE_ROWS + index}
                    isNext={MAX_VISIBLE_ROWS + index === nextIndex}
                    coachLabel={coachLabel}
                    registerToneClass={registerToneClass}
                  />
                ))}
              </ul>
            </details>
          ) : null}
          <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
            {sessionCount > 0
              ? `${places.enrolled} of ${places.capacity} places booked`
              : "No places booked"}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * One session: when it is, which class it is, how many places are
 * taken and what state the register is in. The row is the ONE display
 * owner of the session's occupancy — there is no second capacity panel
 * on the page.
 */
function SessionRow({
  lane,
  index,
  isNext,
  coachLabel,
  registerToneClass,
}: {
  lane: TodaysLane;
  /** The session's position in the whole day. */
  index: number;
  isNext: boolean;
  coachLabel: string;
  registerToneClass: (tone: RegisterTone) => string;
}) {
  const state = registerState(lane);
  const fill = occupancy(lane);
  return (
    <li
      data-testid={isNext ? "owner-home-next-session" : undefined}
      className={`grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 wide:grid-cols-[3.5rem_minmax(0,1fr)_4.5rem_9.5rem] ${
        isNext ? "bg-[var(--surface-featured)]" : ""
      } ${index > 0 ? "border-t border-line" : ""}`}
    >
      <time className="pt-0.5 text-[12px] tabular-nums text-ink-2">
        {formatWallTime12h(lane.startTime)}
      </time>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">
            {lane.batchName}
          </span>
          {isNext ? (
            <span className="whitespace-nowrap rounded-[6px] bg-[var(--action-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--action-ink)]">
              Up next
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
          {lane.programName}
          {lane.coachName
            ? ` · ${lane.coachName}`
            : ` · no ${coachLabel} assigned`}
        </p>
      </div>
      <div className="flex-none text-right">
        <p className="text-[12px] tabular-nums">
          {fill.enrolled}{" "}
          <span className="text-ink-3">/ {fill.capacity}</span>
        </p>
        <ProgressBar
          className="mt-1 w-[4.5rem]"
          value={fill.enrolled}
          max={fill.capacity}
          tone={fill.overBy > 0 ? "late" : fill.fillPct < 50 ? "warn" : "water"}
          label={`${lane.batchName} capacity`}
        />
      </div>
      <p
        className={`col-start-1 col-span-3 text-[11.5px] wide:col-start-4 wide:col-span-1 wide:text-right ${registerToneClass(state.tone)}`}
      >
        {state.text}
      </p>
    </li>
  );
}
