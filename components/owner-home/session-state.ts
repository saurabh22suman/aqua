import type { TodaysLane } from "@/lib/services/dashboard";

// Owner Home — the day's sessions, as pure rules.
//
// The timeline has to say three things about a session, and each of
// them has to be TRUE:
//
//   * how many places are taken (a fraction of the batch capacity,
//     with over-capacity flagged separately);
//   * what state the REGISTER is in — completion, never attendance;
//   * whether the session is the one coming up next.
//
// The third one is the trap. A session that has started is not
// necessarily still running, so "in progress" is claimed only when the
// register says so (marks recorded and the roster not yet complete).
// Everything else is stated as what it is.
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
