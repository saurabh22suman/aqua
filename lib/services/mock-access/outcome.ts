// Mock-only gate access — the shape of a decision.
//
// The outcome a gate returns, the wording for each reason code, and
// the columns the log is read back with. Kept apart from the flow so
// the scan stays about flow.

import { gateAccessEvents } from "@/db/schema/mock-access";
import { GATE_REASON_LABELS, type GateReasonCode } from "./reasons";

export type GateScanOutcome = {
  decision: "granted" | "denied";
  reasonCode: GateReasonCode;
  /** The staff-facing line for the reason code. */
  message: string;
  basis: "booking" | "membership" | null;
  memberId: string | null;
  deviceKey: string;
  eventId: string | null;
  idempotentReplay: boolean;
  occurredAt: string;
};

// The door's answer and the log's answer are not always the same.
//
// A cancelled card and an unknown card answer alike — "we do not
// recognise that card or PIN". Telling a stranger that a tag once
// existed in this academy is an enumeration oracle: it confirms the
// tag is one of ours, which is exactly what someone sweeping tags is
// looking for, and it buys the person at the door nothing they could
// not get from the desk.
//
// The access event keeps the precise reason, so the staff log still
// says a card was cancelled.
const DEVICE_FACING: Partial<Record<GateReasonCode, GateReasonCode>> = {
  denied_credential_revoked: "denied_unknown_credential",
};

// The reason code a device is told. The reason code the log keeps.
export function deviceReason(code: GateReasonCode): GateReasonCode {
  return DEVICE_FACING[code] ?? code;
}

export function outcome(parts: {
  decision: "granted" | "denied";
  reasonCode: GateReasonCode;
  basis?: "booking" | "membership" | null;
  memberId?: string | null;
  deviceKey: string;
  eventId?: string | null;
  idempotentReplay?: boolean;
  occurredAt: string;
}): GateScanOutcome {
  return {
    decision: parts.decision,
    reasonCode: parts.reasonCode,
    message: GATE_REASON_LABELS[parts.reasonCode],
    basis: parts.basis ?? null,
    memberId: parts.memberId ?? null,
    deviceKey: parts.deviceKey,
    eventId: parts.eventId ?? null,
    idempotentReplay: parts.idempotentReplay ?? false,
    occurredAt: parts.occurredAt,
  };
}

// An event id already claimed by a different credential.
export function conflictOutcome(
  deviceKey: string,
  occurredAt: string,
): GateScanOutcome {
  return outcome({
    decision: "denied",
    reasonCode: "denied_event_conflict",
    deviceKey,
    occurredAt,
  });
}

// The columns an already-logged event is read back with.
export const EVENT_COLUMNS = {
  id: gateAccessEvents.id,
  decision: gateAccessEvents.decision,
  reasonCode: gateAccessEvents.reasonCode,
  basis: gateAccessEvents.basis,
  memberId: gateAccessEvents.memberId,
  credentialFingerprint: gateAccessEvents.credentialFingerprint,
  occurredAt: gateAccessEvents.occurredAt,
};
