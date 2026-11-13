import { z } from "zod";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

// Ops completion 2026-11-09 — the evidence an activity row already records.
//
// The audited read (db/ops-operation-writer.ts) records every operation
// with `{ outcome, correlationId, origin }`, and the no-op evidence
// (db/ops-action.ts::recordOpsNoop) records
// `{ outcome: "noop", correlationId, origin }`. Those two values were
// stored and invisible; this module reads them out of the EXISTING detail
// DTO and renders them as the evidence they are.
//
// It reads NAMED values only. The detail object is never printed, so a
// writer that puts something else in the detail cannot leak it.
//
// NOTHING FROM THE DETAIL IS ECHOED. The detail is operator-supplied
// text: a recorded outcome that is not a state the platform defines is
// shown as a fixed "Unrecognized outcome", never as the value that was
// found, and a recorded correlation id is shown only when it is a valid
// uuid — an unrecognised one is not displayed at all, not even in part.
//
// A row whose detail predates the outcome carries NO recorded outcome.
// It is shown as "Not recorded" — never as a success, because the
// platform cannot know what happened to a row it did not describe.

/**
 * The canonical outcomes, in the product's words.
 *
 * This map IS the canonical check: a recorded outcome that is not in it
 * is not a state the platform defines.
 */
const OUTCOME_LABEL: Record<string, string> = {
  success: "Success",
  invalid: "Invalid",
  denied: "Denied",
  error: "Error",
  noop: "No-op",
};

const OUTCOME_TONE: Record<string, StatusTone> = {
  success: "good",
  invalid: "warn",
  denied: "warn",
  error: "late",
  noop: "neutral",
};

/** The UUID rule is zod's own — the same rule the platform applies. */
const UUID = z.string().uuid();

export type ActivityEvidence = {
  /** The recorded outcome, exactly as the writer stored it. */
  outcome: string | null;
  /** The recorded correlation id — only when it is a valid uuid. */
  correlationId: string | null;
};

/** Read the recorded evidence out of a row's detail. */
export function readActivityEvidence(
  detail: Record<string, unknown>,
): ActivityEvidence {
  const outcome =
    typeof detail.outcome === "string" && detail.outcome.trim().length > 0
      ? detail.outcome.trim()
      : null;
  const recordedCorrelation =
    typeof detail.correlationId === "string" ? detail.correlationId.trim() : "";
  const correlationId =
    recordedCorrelation && UUID.safeParse(recordedCorrelation).success
      ? recordedCorrelation
      : null;
  return { outcome, correlationId };
}

/**
 * The outcome pill.
 *
 * A row with no recorded outcome says so. A recorded outcome that is not
 * one of the platform's states is shown as a fixed, neutral label — the
 * value that was found is NEVER printed.
 */
export function ActivityOutcomeBadge({ outcome }: { outcome: string | null }) {
  if (outcome === null) {
    return <StatusBadge tone="neutral">Not recorded</StatusBadge>;
  }
  if (!Object.prototype.hasOwnProperty.call(OUTCOME_LABEL, outcome)) {
    return <StatusBadge tone="neutral">Unrecognized outcome</StatusBadge>;
  }
  return (
    <StatusBadge tone={OUTCOME_TONE[outcome] ?? "neutral"}>
      {OUTCOME_LABEL[outcome]}
    </StatusBadge>
  );
}

/**
 * The truncated reference that ties the row to the operation that wrote
 * it. It is truncated in the same form the row already uses for the
 * actor id, so the row stays one compact line.
 *
 * Only a valid uuid is ever shown, and only in part.
 */
export function ActivityCorrelationRef({
  correlationId,
}: {
  correlationId: string | null;
}) {
  if (correlationId === null) return null;
  return (
    <span className="ml-2 font-mono">
      correlation {correlationId.slice(0, 8)}…
    </span>
  );
}
