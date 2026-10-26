import { describe, expect, it } from "vitest";
import {
  decideGateAccess,
  type GatePolicyFacts,
} from "@/lib/services/mock-access/policy";
import { isGrantReason } from "@/lib/services/mock-access/reasons";

// Mock-only gate access — the access policy.
//
// The policy is the whole point of the lane: a gate opens for a
// booking or an applicable membership, and for nothing else. These
// tests pin the decisions a member and a staff member would argue
// about, in the order they matter:
//
//   * a booking opens the gate it was made for, and only while it runs
//   * a membership opens the gate it was bought for, and only while it
//     runs
//   * anything else is denied WITH a reason, never silently
//
// Pure function, no database: the facts are assembled in gate.ts.

const NOW = new Date("2026-10-26T10:00:00.000Z");
const TODAY = "2026-10-26";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const COURT = "22222222-2222-4222-8222-222222222222";
const COURT_2 = "33333333-3333-4333-8333-333333333333";

function facts(overrides: Partial<GatePolicyFacts> = {}): GatePolicyFacts {
  return {
    device: {
      locationId: LOCATION,
      facilityId: null,
      subUnitId: null,
      acceptsPin: true,
      acceptsRfid: true,
      status: "active",
    },
    method: "pin",
    credential: "verified",
    memberStatus: "active",
    now: NOW,
    today: TODAY,
    bookings: [],
    subscriptions: [],
    ...overrides,
  };
}

function courtGate(overrides: Partial<GatePolicyFacts["device"]> = {}) {
  return {
    locationId: LOCATION,
    facilityId: COURT,
    subUnitId: null,
    acceptsPin: false,
    acceptsRfid: true,
    status: "active" as const,
    ...overrides,
  };
}

function booking(overrides: Partial<GatePolicyFacts["bookings"][number]> = {}) {
  return {
    locationId: LOCATION,
    facilityId: COURT,
    subUnitId: null,
    startsAt: new Date("2026-10-26T09:00:00.000Z"),
    endsAt: new Date("2026-10-26T11:00:00.000Z"),
    ...overrides,
  };
}

function subscription(
  overrides: Partial<GatePolicyFacts["subscriptions"][number]> = {},
) {
  return {
    locationId: LOCATION,
    activityId: COURT,
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    status: "active" as const,
    ...overrides,
  };
}

describe("mock access — the gate policy", () => {
  describe("bookings", () => {
    it("grants a court gate when a booking for that court covers the moment", () => {
      const outcome = decideGateAccess(
        facts({ device: courtGate(), method: "rfid", bookings: [booking()] }),
      );
      expect(outcome).toEqual({
        decision: "granted",
        reasonCode: "granted_booking",
        basis: "booking",
      });
    });

    it("denies once the booking has ended — there is no grace window", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          bookings: [
            booking({
              startsAt: new Date("2026-10-26T08:00:00.000Z"),
              endsAt: new Date("2026-10-26T09:00:00.000Z"),
            }),
          ],
        }),
      );
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_no_active_booking");
    });

    it("denies before the booking starts", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          bookings: [
            booking({
              startsAt: new Date("2026-10-26T11:00:00.000Z"),
              endsAt: new Date("2026-10-26T12:00:00.000Z"),
            }),
          ],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_no_active_booking");
    });

    it("does not open a second court to a member booked on the first", () => {
      const outcome = decideGateAccess(
        facts({ device: courtGate({ facilityId: COURT_2 }), method: "rfid", bookings: [booking()] }),
      );
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_not_booked_here");
    });

    it("does not open court two to a member booked on court one", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate({ subUnitId: "court-2" }),
          method: "rfid",
          bookings: [booking({ subUnitId: "court-1" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_not_booked_here");
    });

    it("opens the premises gate for a booking anywhere at the location", () => {
      const outcome = decideGateAccess(
        facts({ device: facts().device, bookings: [booking()] }),
      );
      expect(outcome.reasonCode).toBe("granted_booking");
    });
  });

  describe("memberships", () => {
    it("grants a court gate for a membership scoped to that facility", () => {
      const outcome = decideGateAccess(
        facts({ device: courtGate(), method: "rfid", subscriptions: [subscription()] }),
      );
      expect(outcome).toEqual({
        decision: "granted",
        reasonCode: "granted_membership",
        basis: "membership",
      });
    });

    it("does not open a court to a membership that names no facility", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [subscription({ activityId: null })],
        }),
      );
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_membership_not_applicable");
    });

    it("opens the premises gate for a membership that names no facility", () => {
      const outcome = decideGateAccess(
        facts({ subscriptions: [subscription({ activityId: null })] }),
      );
      expect(outcome.reasonCode).toBe("granted_membership");
    });

    it("denies an expired membership", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [subscription({ endsOn: "2026-10-25" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_membership_expired");
    });

    it("denies a membership that has not started yet", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [subscription({ startsOn: "2026-10-27" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_membership_expired");
    });

    it("denies a paused membership", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [subscription({ status: "paused" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_membership_paused");
    });

    it("treats the first and last covered day as inside the window", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [
            subscription({ startsOn: TODAY, endsOn: TODAY }),
          ],
        }),
      );
      expect(outcome.reasonCode).toBe("granted_membership");
    });

    it("does not carry a membership across locations", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate(),
          method: "rfid",
          subscriptions: [subscription({ locationId: "other-location" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_no_membership");
    });
  });

  describe("hard denials", () => {
    it("denies an unknown credential", () => {
      const outcome = decideGateAccess(facts({ credential: "unknown" }));
      expect(outcome.reasonCode).toBe("denied_unknown_credential");
    });

    it("denies a revoked credential", () => {
      const outcome = decideGateAccess(facts({ credential: "revoked" }));
      expect(outcome.reasonCode).toBe("denied_credential_revoked");
    });

    it("denies a member whose membership is not active", () => {
      const outcome = decideGateAccess(facts({ memberStatus: "lapsed" }));
      expect(outcome.reasonCode).toBe("denied_member_inactive");
    });

    it("denies a PIN at a gate that only reads RFID", () => {
      const outcome = decideGateAccess(
        facts({ device: courtGate(), method: "pin" }),
      );
      expect(outcome.reasonCode).toBe("denied_method_not_accepted");
    });

    it("denies a disabled gate", () => {
      const outcome = decideGateAccess(
        facts({ device: courtGate({ status: "disabled" }), method: "rfid" }),
      );
      expect(outcome.reasonCode).toBe("denied_device_disabled");
    });
  });

  describe("the denial always has a reason", () => {
    it("never pairs a grant with a denial reason", () => {
      const outcomes = [
        decideGateAccess(facts({ device: courtGate(), bookings: [booking()] })),
        decideGateAccess(
          facts({ device: courtGate(), subscriptions: [subscription()] }),
        ),
        decideGateAccess(facts()),
        decideGateAccess(facts({ credential: "unknown" })),
        decideGateAccess(facts({ credential: "revoked" })),
        decideGateAccess(facts({ memberStatus: "lapsed" })),
      ];
      for (const outcome of outcomes) {
        expect(outcome.decision === "granted").toBe(
          isGrantReason(outcome.reasonCode),
        );
      }
    });

    it("names the missing policy when there is neither booking nor membership", () => {
      const outcome = decideGateAccess(facts());
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_no_membership");
      expect(outcome.basis).toBeNull();
    });

    it("prefers the booking reason when the member is booked elsewhere", () => {
      const outcome = decideGateAccess(
        facts({
          device: courtGate({ facilityId: COURT_2 }),
          method: "rfid",
          bookings: [booking()],
          subscriptions: [subscription({ endsOn: "2026-10-25" })],
        }),
      );
      expect(outcome.reasonCode).toBe("denied_not_booked_here");
    });
  });
});
