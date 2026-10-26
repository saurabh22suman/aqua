// Mock-only gate access — the closed vocabulary of gate decisions.
//
// A gate has two jobs: say YES or NO, and say WHY in words a member
// and a staff member can both read. Every decision this lane produces
// carries exactly one of these codes — there is no "denied, unknown
// reason" path. The set is mirrored by a CHECK constraint in
// db/migrations/20261025234623_mock_gate_access.sql, so a code that
// does not exist here cannot reach the database either.
//
// Three granted codes:
//   granted_booking       — a booking for this gate covers now.
//   granted_membership    — an applicable, current membership covers
//                           this gate.
//   granted_manual_override — a staff member authorised this entry
//                           explicitly, with a recorded reason.
//
// The denied codes are ordered from "the gate itself refused" to
// "this member's entitlements do not reach this gate", which is the
// order a reader wants them in.

export const GATE_REASON_CODES = [
  "granted_booking",
  "granted_membership",
  "granted_manual_override",
  "denied_device_disabled",
  "denied_method_not_accepted",
  "denied_unknown_device",
  "denied_unknown_credential",
  "denied_credential_revoked",
  "denied_member_inactive",
  "denied_no_active_booking",
  "denied_not_booked_here",
  "denied_membership_paused",
  "denied_membership_expired",
  "denied_membership_not_applicable",
  "denied_no_membership",
  "denied_event_conflict",
] as const;

export type GateReasonCode = (typeof GATE_REASON_CODES)[number];

export const GATE_GRANTED_REASON_CODES = [
  "granted_booking",
  "granted_membership",
  "granted_manual_override",
] as const satisfies readonly GateReasonCode[];

const GRANTED = new Set<string>(GATE_GRANTED_REASON_CODES);

export function isGrantReason(code: GateReasonCode): boolean {
  return GRANTED.has(code);
}

// Staff-facing wording for the access log. Short enough for a log
// column, specific enough that a coach can act on it ("their
// membership has run out" is actionable; "access denied" is not).
export const GATE_REASON_LABELS: Record<GateReasonCode, string> = {
  granted_booking: "Access granted — a booking covers this gate now.",
  granted_membership: "Access granted — an active membership covers this gate.",
  granted_manual_override: "Access granted by a staff override.",
  denied_device_disabled: "This gate is switched off.",
  denied_method_not_accepted: "This gate does not accept that method.",
  denied_unknown_device: "This gate is not registered here.",
  denied_unknown_credential: "We do not recognise that card or PIN.",
  denied_credential_revoked: "That card or PIN has been cancelled.",
  denied_member_inactive: "This member's membership is not active.",
  denied_no_active_booking: "There is no booking running at this gate now.",
  denied_not_booked_here: "Your booking is for a different court.",
  denied_membership_paused: "This membership is paused.",
  denied_membership_expired: "This membership has expired.",
  denied_membership_not_applicable: "This membership does not cover this court.",
  denied_no_membership: "There is no membership or booking for this gate.",
  denied_event_conflict:
    "This access event was already recorded with a different credential.",
};
