// Ops reliability lane (9 November 2026) — the DAILY SNAPSHOT's freshness.
//
// The Overview's figure strip is a snapshot written by the nightly
// platform.metrics-snapshot job. This module decides ONE thing: is the
// snapshot recent enough to be shown as the platform's figures, and if
// it is not, what the console is allowed to say about it.
//
// THE THRESHOLD IS A LOCAL DISPLAY ASSUMPTION, NOT A SERVICE-LEVEL
// OBJECTIVE. The job runs once a day, so a healthy snapshot is at most
// a day old; thirty hours (24h + 6h tolerance) is the point past which
// the figures are presented as stale. Exactly thirty hours is still
// inside the window. It is not a health check, not a backup statement,
// and not derived from any measured operational target.
//
// IT READS THE SNAPSHOT'S OWN TIMESTAMP AND NOTHING ELSE. No health
// endpoint, no worker heartbeat, no backup record, no provider status:
// this console holds none of those facts, and nothing here may imply
// that it does.
//
// Pure on purpose: a timestamp in, a state out. The clock belongs to
// the caller, so the decision is explicit and repeatable.

import { formatDateTimeIST } from "@/lib/time/tz";

/**
 * The DISPLAY threshold, in hours: a daily snapshot plus a six-hour
 * tolerance. A local assumption for this console, not an SLO.
 */
export const SNAPSHOT_STALE_AFTER_HOURS = 30;

const HOUR_MS = 60 * 60 * 1000;
const STALE_AFTER_MS = SNAPSHOT_STALE_AFTER_HOURS * HOUR_MS;

/**
 * What the console may say about the snapshot.
 *
 * - `missing` — no snapshot has been written yet. The figures are
 *   unavailable, never zero.
 * - `fresh` — inside the window. The figures are shown plainly and the
 *   page says nothing about their age: a page that always warns is as
 *   dishonest as one that never warns.
 * - `stale` — older than the window. The figures are the last known
 *   values, and the page says so next to them.
 * - `future` — the timestamp is ahead of the caller's clock. The
 *   figures cannot be presented as current.
 * - `unreadable` — the timestamp could not be read at all.
 */
export type SnapshotFreshness =
  | { kind: "missing" }
  | { kind: "fresh"; asOf: Date; ageMs: number }
  | { kind: "stale"; asOf: Date; ageMs: number }
  | { kind: "future"; asOf: Date; ageMs: number }
  | { kind: "unreadable" };

/**
 * Classify the snapshot's own timestamp.
 *
 * A value that carries no instant — a Date that is not a real date, or
 * anything that is not a Date at all — is `unreadable`: never a crash,
 * and never a snapshot presented as current.
 */
export function classifySnapshot(
  asOf: Date | null | undefined,
  now: Date,
): SnapshotFreshness {
  if (asOf == null) return { kind: "missing" };
  const at = asOf instanceof Date ? asOf.getTime() : Number.NaN;
  if (Number.isNaN(at)) return { kind: "unreadable" };
  const ageMs = now.getTime() - at;
  if (ageMs < 0) return { kind: "future", asOf, ageMs };
  if (ageMs > STALE_AFTER_MS) return { kind: "stale", asOf, ageMs };
  return { kind: "fresh", asOf, ageMs };
}

/**
 * The header's one line about the snapshot.
 *
 * It says WHEN the snapshot was computed. When the timestamp cannot be
 * trusted it says that instead of printing a moment the console does
 * not believe, and it says nothing at all when there is no snapshot.
 */
export function snapshotMetaText(snapshot: SnapshotFreshness): string | null {
  if (snapshot.kind === "missing") return null;
  if (snapshot.kind === "unreadable") {
    return "Daily snapshot timestamp could not be read";
  }
  if (snapshot.kind === "future") {
    return "Daily snapshot timestamp is later than the clock on this server";
  }
  return `Daily snapshot computed ${formatDateTimeIST(snapshot.asOf)} IST`;
}
