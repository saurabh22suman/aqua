// Mock-only gate access — the scan.
//
// One device event in, one decision out, and exactly one row in the
// access log. The log is idempotent on (tenant, device, client event
// id): a device that replays an event it already sent gets the same
// event back instead of a second entry, and a replay carrying a
// DIFFERENT credential under the same event id is refused as a
// conflict rather than silently re-decided.
//
// Two rules the replay paths share:
//
//   * An event id belongs to the credential that logged it. A replay
//     with a different credential is a conflict, whichever writer
//     won the race — including the writer that lost the insert.
//   * A replay is decided on the facts of THIS moment, not on the
//     decision that was stored earlier. A replay can therefore never
//     outlive the booking or membership that opened the gate.
//
// The decision, the reads behind it and the log row are ONE
// transaction. There is no state in which a gate has decided but not
// recorded, or recorded a decision it never made.

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { gateAccessEvents } from "@/db/schema/mock-access";
import { asMemberId, type TenantId } from "@/lib/ids";
import { deviceByKeyInTx } from "./devices";
import { gatherGateFacts } from "./facts";
import { decideGateAccess } from "./policy";
import {
  conflictOutcome,
  deviceReason,
  EVENT_COLUMNS,
  outcome,
  type GateScanOutcome,
} from "./outcome";
import type { GateReading } from "./reader";
import { gateCredentialFingerprintCandidates } from "./secret";
import { verifyGateCredential } from "./verification";

export const gateScanInput = z.object({
  deviceKey: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  method: z.enum(["pin", "rfid"]),
  // A blank presentation is allowed in: it is a denial, not a
  // malformed request.
  secret: z.string().max(128),
  clientEventId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
});

export type GateScanInput = {
  tenantId: TenantId;
  deviceKey: string;
  method: "pin" | "rfid";
  secret: string;
  clientEventId: string;
};

export type GateScanOptions = {
  /** Test seam only. Production always uses the server clock. */
  now?: Date;
};

export async function evaluateGateScan(
  input: GateScanInput,
  options: GateScanOptions = {},
): Promise<GateScanOutcome> {
  const parsed = gateScanInput.safeParse({
    deviceKey: input.deviceKey,
    method: input.method,
    secret: input.secret,
    clientEventId: input.clientEventId,
  });
  if (!parsed.success) {
    // A malformed event is a protocol error, not an access decision:
    // there is no reason code for "the device sent nonsense", and the
    // boundary that receives it answers 400.
    throw new Error(
      `mock-access: invalid gate scan input — ${
        parsed.error.issues[0]?.message ?? "invalid request"
      }`,
    );
  }
  const { deviceKey, method, secret, clientEventId } = parsed.data;
  // The server's clock decides. A device's own clock is never trusted.
  const now = options.now ?? new Date();

  return withTenant(input.tenantId, async (tx) => {
    const device = await deviceByKeyInTx(tx, input.tenantId, deviceKey);
    if (!device) {
      // No device row means no log row to attach the event to, and no
      // gate this academy owns was presented at.
      return outcome({
        decision: "denied",
        reasonCode: "denied_unknown_device",
        deviceKey,
        occurredAt: now.toISOString(),
      });
    }

    // The digest the event records is the CURRENT key's digest, so a
    // rotation does not change what a replayed event is compared
    // against. The candidate set carries the previous key too, so an
    // event logged before a rotation is still recognised as the same
    // event when the device retries it.
    const candidates = gateCredentialFingerprintCandidates(
      input.tenantId,
      method,
      secret,
    );
    const fingerprint = candidates[0]!;
    const knownFingerprints = new Set(candidates);

    // The decision for THIS moment, from the facts of this moment.
    const decideNow = async () => {
      const verification = await verifyGateCredential(
        tx,
        input.tenantId,
        method,
        secret,
      );
      const memberId =
        verification.state === "unknown" ? null : verification.match.memberId;
      const facts = await gatherGateFacts(
        tx,
        input.tenantId,
        device,
        memberId,
        now,
      );
      const decided = decideGateAccess({
        device: facts.device,
        method,
        credential: verification.state,
        memberStatus: facts.memberStatus,
        now,
        today: facts.today,
        bookings: facts.bookings,
        subscriptions: facts.subscriptions,
      });
      // The door only knows who someone is when the credential was
      // recognised. A cancelled or unknown card answers "we do not
      // recognise that card or PIN", so the device must not be handed
      // the member it used to belong to. The access event keeps it.
      const doorMemberId = verification.state === "verified" ? memberId : null;
      return { decided, verification, memberId, doorMemberId };
    };

    // --- idempotency ----------------------------------------------------
    const priorRows = await tx
      .select(EVENT_COLUMNS)
      .from(gateAccessEvents)
      .where(
        and(
          eq(gateAccessEvents.tenantId, input.tenantId),
          eq(gateAccessEvents.deviceId, device.id),
          eq(gateAccessEvents.clientEventId, clientEventId),
        ),
      )
      .limit(1);
    const prior = priorRows[0];

    if (prior) {
      if (
        prior.credentialFingerprint === null ||
        !knownFingerprints.has(prior.credentialFingerprint)
      ) {
        // The same event id carrying a DIFFERENT credential. The stored
        // decision stands; this event is refused rather than re-decided.
        return conflictOutcome(deviceKey, now.toISOString());
      }
      // The same event, same credential: decide again on the facts of
      // this moment (a replay must not outlive its entitlement) and
      // write nothing — the event is already logged.
      const { decided, doorMemberId } = await decideNow();
      return outcome({
        decision: decided.decision,
        reasonCode: deviceReason(decided.reasonCode),
        basis: decided.basis,
        memberId: doorMemberId,
        deviceKey,
        eventId: prior.id,
        idempotentReplay: true,
        occurredAt: now.toISOString(),
      });
    }

    // --- the facts and the decision -------------------------------------
    const { decided, verification, memberId, doorMemberId } = await decideNow();

    // --- the log row -----------------------------------------------------
    const inserted = await tx
      .insert(gateAccessEvents)
      .values({
        tenantId: input.tenantId,
        deviceId: device.id,
        memberId: memberId ? asMemberId(memberId) : null,
        credentialId:
          verification.state === "unknown"
            ? null
            : verification.match.credentialId,
        credentialFingerprint: fingerprint,
        method,
        decision: decided.decision,
        reasonCode: decided.reasonCode,
        basis: decided.basis,
        overrideReason: null,
        decidedBy: null,
        occurredAt: now,
        clientEventId,
      })
      .onConflictDoNothing()
      .returning({ id: gateAccessEvents.id });

    const eventId = inserted[0]?.id;
    if (!eventId) {
      // Another writer inserted the same event id while this one was
      // deciding. The winner's row is read back, and the same rules
      // apply: a different credential loses the event id, the same
      // credential replays it.
      const raced = await tx
        .select(EVENT_COLUMNS)
        .from(gateAccessEvents)
        .where(
          and(
            eq(gateAccessEvents.tenantId, input.tenantId),
            eq(gateAccessEvents.deviceId, device.id),
            eq(gateAccessEvents.clientEventId, clientEventId),
          ),
        )
        .limit(1);
      const row = raced[0];
      if (!row) {
        throw new Error(
          "mock-access: the access event vanished between the insert and the read",
        );
      }
      if (
        row.credentialFingerprint === null ||
        !knownFingerprints.has(row.credentialFingerprint)
      ) {
        return conflictOutcome(deviceKey, now.toISOString());
      }
      const replayed = await decideNow();
      return outcome({
        decision: replayed.decided.decision,
        reasonCode: deviceReason(replayed.decided.reasonCode),
        basis: replayed.decided.basis,
        memberId: replayed.doorMemberId,
        deviceKey,
        eventId: row.id,
        idempotentReplay: true,
        occurredAt: now.toISOString(),
      });
    }

    return outcome({
      decision: decided.decision,
      reasonCode: deviceReason(decided.reasonCode),
      basis: decided.basis,
      memberId: doorMemberId,
      deviceKey,
      eventId,
      occurredAt: now.toISOString(),
    });
  });
}

// The reader boundary: the same decision, driven by what a gate
// device presented rather than by a method and a value.
export async function evaluateGateReading(
  input: {
    tenantId: TenantId;
    deviceKey: string;
    reading: GateReading;
    clientEventId: string;
  },
  options: GateScanOptions = {},
): Promise<GateScanOutcome> {
  return evaluateGateScan(
    {
      tenantId: input.tenantId,
      deviceKey: input.deviceKey,
      method: input.reading.kind,
      secret: input.reading.value,
      clientEventId: input.clientEventId,
    },
    options,
  );
}
