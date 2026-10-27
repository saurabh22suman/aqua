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
// A quiet day is not an empty block: it names the next class, with its
// coach, its date, its time and its occupancy.
export function OwnerHomeTimeline({
  lanes,
  marked,
  enrolled,
  membersLabel,
  coachLabel,
  sessionsLabel,
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

  return (
    <section data-testid="owner-home-today" aria-label="Your club today">
      <SectionHeader
        className="mb-2"
        title="Your club today"
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
        <div className="rounded-card border border-line bg-paper px-4 py-4">
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
        <div className="overflow-hidden rounded-card border border-line bg-paper">
          <ul>
            {lanes.map((lane, index) => {
              const state = registerState(lane);
              const fill = occupancy(lane);
              const isNext = index === nextIndex;
              return (
                <li
                  key={lane.sessionId}
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
            })}
          </ul>
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
