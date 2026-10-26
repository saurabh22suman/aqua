// Mock-only gate access — the access policy.
//
// This module is PURE: given the facts about a gate, a credential, a
// member and their entitlements, it says yes or no and says why. No
// database, no clock of its own, no environment. The database work
// (gathering the facts) lives in gate.ts; this file only decides.
//
// The policy is deliberately narrow, and the narrowness is the point:
//
//   * A gate bound to a facility (a court) only opens for a booking or
//     a membership that names THAT facility. A membership that is not
//     facility-scoped opens the premises gate and nothing else. This
//     is the rule that stops every member walking into every court.
//   * A booking covers the gate only between its own start and end
//     instants. There is no grace period before or after: a booking
//     that ended is over, and inventing a buffer would hand out access
//     nobody booked.
//   * A membership covers the gate only on a day inside its own
//     window (starts_on is inclusive, ends_on is inclusive, the same
//     convention C-30 uses for subscriptions) and only while it is
//     active. A paused or expired membership never grants.
//   * When nothing grants, the denial names the most actionable fact
//     the tenant actually holds — "your booking is for a different
//     court" beats "no membership" when both are true.

import type { GateReasonCode } from "./reasons";

export type GateCredentialState = "unknown" | "revoked" | "verified";

export type GateDeviceFacts = {
  locationId: string;
  /** null = the premises gate (no facility of its own). */
  facilityId: string | null;
  /** null = the whole facility (any court inside it). */
  subUnitId: string | null;
  acceptsPin: boolean;
  acceptsRfid: boolean;
  status: "active" | "disabled";
};

export type GateBookingFacts = {
  locationId: string;
  facilityId: string;
  subUnitId: string | null;
  startsAt: Date;
  endsAt: Date;
};

export type GateSubscriptionFacts = {
  locationId: string;
  /** The facility this membership is scoped to; null = the location. */
  activityId: string | null;
  startsOn: string;
  endsOn: string;
  status: "active" | "paused" | "expired" | "cancelled";
};

export type GatePolicyFacts = {
  device: GateDeviceFacts;
  method: "pin" | "rfid";
  credential: GateCredentialState;
  /** null when the member row is gone; a soft-deleted member reads inactive. */
  memberStatus: string | null;
  /** The server's clock. A device's own clock is never trusted. */
  now: Date;
  /** The tenant-local day (yyyy-mm-dd) the membership windows use. */
  today: string;
  bookings: GateBookingFacts[];
  subscriptions: GateSubscriptionFacts[];
};

export type GatePolicyOutcome = {
  decision: "granted" | "denied";
  reasonCode: GateReasonCode;
  basis: "booking" | "membership" | null;
};

// A member may enter on a current membership or a trial. "paused",
// "lapsed" and "left" are not entering states.
const ENTERABLE_MEMBER_STATUSES = new Set(["active", "trial"]);

function bookingCoversGate(device: GateDeviceFacts, booking: GateBookingFacts): boolean {
  if (booking.locationId !== device.locationId) return false;
  // The premises gate stands for the whole location.
  if (device.facilityId === null) return true;
  if (booking.facilityId !== device.facilityId) return false;
  // A court gate may be bound to one court inside the facility.
  if (device.subUnitId === null) return true;
  // A booking that names no court booked the whole facility, so it
  // covers every court in it.
  if (booking.subUnitId === null) return true;
  return booking.subUnitId === device.subUnitId;
}

function bookingCoversNow(booking: GateBookingFacts, now: Date): boolean {
  const at = now.getTime();
  return booking.startsAt.getTime() <= at && at < booking.endsAt.getTime();
}

function subscriptionInWindow(
  subscription: GateSubscriptionFacts,
  today: string,
): boolean {
  return subscription.startsOn <= today && today <= subscription.endsOn;
}

export function decideGateAccess(facts: GatePolicyFacts): GatePolicyOutcome {
  const { device, method, credential, memberStatus, now, today } = facts;

  if (device.status !== "active") {
    return { decision: "denied", reasonCode: "denied_device_disabled", basis: null };
  }

  const methodAccepted =
    method === "pin" ? device.acceptsPin : device.acceptsRfid;
  if (!methodAccepted) {
    return {
      decision: "denied",
      reasonCode: "denied_method_not_accepted",
      basis: null,
    };
  }

  if (credential === "unknown") {
    return {
      decision: "denied",
      reasonCode: "denied_unknown_credential",
      basis: null,
    };
  }

  if (credential === "revoked") {
    return {
      decision: "denied",
      reasonCode: "denied_credential_revoked",
      basis: null,
    };
  }

  if (!memberStatus || !ENTERABLE_MEMBER_STATUSES.has(memberStatus)) {
    return {
      decision: "denied",
      reasonCode: "denied_member_inactive",
      basis: null,
    };
  }

  // --- the two ways in -------------------------------------------------

  const applicableBookings = facts.bookings.filter((booking) =>
    bookingCoversGate(device, booking),
  );
  const liveBooking = applicableBookings.find((booking) =>
    bookingCoversNow(booking, now),
  );
  if (liveBooking) {
    return { decision: "granted", reasonCode: "granted_booking", basis: "booking" };
  }

  const applicableSubscriptions = facts.subscriptions.filter((subscription) => {
    if (subscription.locationId !== device.locationId) return false;
    // A court gate needs a facility-scoped membership. A membership
    // that names no facility covers the premises, not the courts.
    if (device.facilityId !== null) {
      return subscription.activityId === device.facilityId;
    }
    return true;
  });
  const liveSubscription = applicableSubscriptions.find(
    (subscription) =>
      subscription.status === "active" &&
      subscriptionInWindow(subscription, today),
  );
  if (liveSubscription) {
    return {
      decision: "granted",
      reasonCode: "granted_membership",
      basis: "membership",
    };
  }

  // --- nothing granted: name the most actionable fact -------------------

  if (applicableBookings.length > 0) {
    return {
      decision: "denied",
      reasonCode: "denied_no_active_booking",
      basis: null,
    };
  }

  const bookedElsewhere = facts.bookings.some(
    (booking) => booking.locationId === device.locationId,
  );
  if (bookedElsewhere) {
    return {
      decision: "denied",
      reasonCode: "denied_not_booked_here",
      basis: null,
    };
  }

  const pausedNow = applicableSubscriptions.some(
    (subscription) =>
      subscription.status === "paused" &&
      subscriptionInWindow(subscription, today),
  );
  if (pausedNow) {
    return {
      decision: "denied",
      reasonCode: "denied_membership_paused",
      basis: null,
    };
  }

  if (applicableSubscriptions.length > 0) {
    return {
      decision: "denied",
      reasonCode: "denied_membership_expired",
      basis: null,
    };
  }

  const membershipsAtLocation = facts.subscriptions.some(
    (subscription) => subscription.locationId === device.locationId,
  );
  if (membershipsAtLocation) {
    return {
      decision: "denied",
      reasonCode: "denied_membership_not_applicable",
      basis: null,
    };
  }

  return {
    decision: "denied",
    reasonCode: "denied_no_membership",
    basis: null,
  };
}
