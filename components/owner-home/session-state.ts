import type { TodaysLane } from "@/lib/services/dashboard";

// Owner Home — the day's sessions, as pure rules.
//
// The approved row (3 November 2026) states: the time, the class with a
// readable COACH and the SESSION'S OWN venue, and ONE truthful state
// pill. Its facts are:
//
//   * the session's recorded status when the read supplies one — the
//     real enum is scheduled | held | cancelled (a `completed` value is
//     still honoured for compatibility);
//   * otherwise the session's CLOCK window (real timestamps): Earlier
//     today / Scheduled now / Starts in N min / Scheduled;
//   * otherwise the legacy `started` flag: Started / Scheduled.
//
// "Scheduled now" is a statement about the clock window, never recorded
// attendance, and register completion is NEVER recast as session
// progress or as attendance. The register and occupancy helpers below
// stay truthful on their own terms; the row uses the session's venue
// (never a batch's), and an over-capacity batch is still SAID.
//
// The rules live here, apart from the markup, so a test can read them
// without a DOM and the timeline cannot state one thing on one screen
// and another on the next.
//
// NOTE — this module returns a TONE, never a colour class. The
// reserved money/attendance tokens (good / late / warn) are only
// allowed in the files the semantic-token rule sanctions, and this
// file is not one of them; the caller maps the tone onto its class.

/**
 * The tone of a register state.
 *   neutral — a fact, not a state that needs attention
 *   warn    — the session has started and nothing has been marked
 *   good    — every expected swimmer has a mark
 */
export type RegisterTone = "neutral" | "warn" | "good";

/**
 * The register state of one session.
 *
 * Register state is COMPLETION — how many of the swimmers the session
 * expected have a mark — and never attendance. A mark of any status
 * counts, because the register has been filled for that swimmer.
 */
export function registerState(lane: TodaysLane): {
  text: string;
  tone: RegisterTone;
} {
  const marked = Math.min(lane.marked, lane.enrolled);
  if (lane.enrolled === 0) {
    return { text: "No one enrolled yet", tone: "neutral" };
  }
  if (!lane.started) {
    return {
      text: "Register opens when the session starts",
      tone: "neutral",
    };
  }
  if (marked === 0) {
    return { text: "Register not started", tone: "warn" };
  }
  if (marked < lane.enrolled) {
    return {
      text: `Register in progress — ${marked} of ${lane.enrolled} marked`,
      tone: "neutral",
    };
  }
  return {
    text: `Register complete — ${marked} of ${lane.enrolled} marked`,
    tone: "good",
  };
}

/**
 * The index of the session that is coming up next: the first one that
 * has not started yet. -1 when every session has already started (or
 * there are none), which is when no session may be called "up next".
 */
export function nextUpcomingIndex(lanes: readonly TodaysLane[]): number {
  return lanes.findIndex((lane) => !lane.started);
}

/** The occupancy of a session, as a fraction of its capacity. */
export function occupancy(lane: TodaysLane): {
  enrolled: number;
  capacity: number;
  overBy: number;
  fillPct: number;
} {
  const overBy = lane.capacity > 0 ? lane.enrolled - lane.capacity : 0;
  return {
    enrolled: lane.enrolled,
    capacity: lane.capacity,
    overBy,
    fillPct:
      lane.capacity > 0
        ? Math.min(100, Math.round((lane.enrolled / lane.capacity) * 100))
        : 0,
  };
}

/** The day's aggregate occupancy — the places taken against the places. */
export function placesBooked(lanes: readonly TodaysLane[]): {
  enrolled: number;
  capacity: number;
} {
  return lanes.reduce(
    (total, lane) => ({
      enrolled: total.enrolled + lane.enrolled,
      capacity: total.capacity + lane.capacity,
    }),
    { enrolled: 0, capacity: 0 },
  );
}

/**
 * Optional UI display fields agreed for the session row while the read-model
 * DTO proposal is reviewed independently. They are OPTIONAL: a legacy row
 * without them still renders truthfully, and no value is ever invented.
 */
export type TodaysLaneDisplay = TodaysLane & {
  /** The real instant the session starts (ISO), when the read provides it. */
  startsAt?: string;
  /** The real instant it ends, or null when unknown. */
  endsAt?: string | null;
  /** The batch's facility name, when the read provides it. */
  locationName?: string | null;
  /** The session's existing lifecycle status, when the read provides it. */
  status?: string;
};

export type SessionStateTone = "neutral" | "good" | "warn" | "late";

/**
 * The session's state as the row may TRUTHFULLY state it.
 *
 *   * a real recorded status is used as-is: the schema's enum is
 *     scheduled | held | cancelled, so "Held" is shown for a held
 *     session; `completed` is still honoured for compatibility. None of
 *     these is ever inferred from register completion or a passed end
 *     time;
 *   * with real timestamps: "Earlier today" once the window has passed,
 *     "Scheduled now" while the clock window is open (a CLOCK statement, not
 *     recorded attendance), "Starts in N min" inside the hour, else
 *     "Scheduled";
 *   * without timestamps (legacy rows) the existing `started` flag decides:
 *     "Started" or "Scheduled".
 */
export function sessionStateFor(
  lane: TodaysLaneDisplay,
  now: number = Date.now(),
): { text: string; tone: SessionStateTone } {
  // The RECORDED fact outranks every clock inference. `held` is the real
  // "the session took place" value in the schema (scheduled|held|cancelled);
  // `completed` is kept for compatibility with earlier read models.
  if (lane.status === "held") return { text: "Held", tone: "good" };
  if (lane.status === "completed") return { text: "Completed", tone: "good" };
  if (lane.status === "cancelled") return { text: "Cancelled", tone: "late" };
  const startsAt = lane.startsAt ? Date.parse(lane.startsAt) : Number.NaN;
  const endsAt = lane.endsAt ? Date.parse(lane.endsAt) : Number.NaN;
  if (Number.isFinite(startsAt)) {
    if (Number.isFinite(endsAt) && now >= endsAt) {
      return { text: "Earlier today", tone: "neutral" };
    }
    if (now >= startsAt) return { text: "Scheduled now", tone: "good" };
    const minutesUntil = Math.ceil((startsAt - now) / 60_000);
    if (minutesUntil <= 60) {
      return { text: `Starts in ${minutesUntil} min`, tone: "good" };
    }
    return { text: "Scheduled", tone: "neutral" };
  }
  return lane.started
    ? { text: "Started", tone: "neutral" }
    : { text: "Scheduled", tone: "neutral" };
}
