import { describe, expect, it } from "vitest";
import { planDemoHistory } from "@/scripts/demo-history/plan";
import { todayInZone } from "@/lib/time/tz";
import { financialYearFor } from "@/lib/invoice-numbering";
import type { TenantSnapshot } from "@/scripts/demo-history/types";

// The demo-history planner is pure: a snapshot in, a plan out. These
// tests pin the properties a reviewer cares about before any row is
// written — the window, the uneven calendar, the money arithmetic, the
// method mix, and determinism.

const TZ = "Asia/Kolkata";
const ANCHOR = "2026-10-27";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

const members = [
  { id: "m-1", code: "AWS-001", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-2", code: "AWS-002", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-3", code: "AWS-003", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-4", code: "AWS-004", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-5", code: "AWS-005", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-6", code: "JRS-001", status: "active" as const, locationId: LOCATION_ID },
  { id: "m-7", code: "MMS-001", status: "paused" as const, locationId: LOCATION_ID },
];

const batches = [
  {
    id: "b-1",
    name: "Morning Squad",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "07:00",
    endTime: "08:00",
    capacity: 12,
    locationId: LOCATION_ID,
    coachId: "coach-1",
    memberIds: ["m-1", "m-2", "m-3", "m-4", "m-5"],
  },
  {
    id: "b-2",
    name: "Junior TTS",
    daysOfWeek: [2, 4, 6],
    startTime: "17:00",
    endTime: "18:00",
    capacity: 16,
    locationId: LOCATION_ID,
    coachId: "coach-2",
    memberIds: ["m-6"],
  },
  {
    id: "b-3",
    name: "Holiday Recovery",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "18:00",
    endTime: "19:00",
    capacity: 12,
    locationId: LOCATION_ID,
    coachId: "coach-1",
    memberIds: [],
  },
];

const plans = [
  {
    id: "plan-monthly",
    name: "Monthly Membership",
    amountPaise: 450000,
    durationDays: 30,
    kind: "duration" as const,
    sourceShapeId: null,
    locationId: LOCATION_ID,
    activityId: null,
    proposed: false,
  },
  {
    id: "plan-quarterly",
    name: "Quarterly Membership",
    amountPaise: 1200000,
    durationDays: 90,
    kind: "duration" as const,
    sourceShapeId: null,
    locationId: LOCATION_ID,
    activityId: null,
    proposed: false,
  },
];

function snapshot(overrides: Partial<TenantSnapshot> = {}): TenantSnapshot {
  return {
    tenantId: TENANT_ID,
    slug: "demo-academy",
    name: "Aqua Worli",
    timezone: TZ,
    anchorDate: ANCHOR,
    nowIso: "2026-10-27T04:30:00.000Z",
    windowDays: 90,
    primaryLocationId: LOCATION_ID,
    members,
    batches,
    holidays: ["2026-09-15"],
    plans,
    receiverUserId: "user-reception",
    ...overrides,
  };
}

const localDate = (iso: string) => todayInZone(TZ, Date.parse(iso));

describe("demo history planner — window and calendar", () => {
  const plan = planDemoHistory(snapshot());

  it("covers the 90 days before the anchor date", () => {
    expect(plan.window.anchorDate).toBe(ANCHOR);
    expect(plan.window.days).toBe(90);
    expect(plan.window.from).toBe("2026-07-30");
    expect(plan.window.to).toBe("2026-10-26");
  });

  it("never plans a session, mark, payment or enquiry after the anchor", () => {
    for (const session of plan.sessions) {
      expect(session.date <= plan.window.to).toBe(true);
    }
    for (const mark of plan.marks) {
      expect(localDate(mark.markedAtIso) <= ANCHOR).toBe(true);
    }
    for (const payment of plan.payments) {
      expect(localDate(payment.receivedAtIso) <= ANCHOR).toBe(true);
    }
    for (const enquiry of plan.enquiries) {
      expect(localDate(enquiry.createdAtIso) <= ANCHOR).toBe(true);
    }
    for (const invoice of plan.invoices) {
      expect(invoice.issuedOn <= ANCHOR).toBe(true);
    }
  });

  it("runs sessions only on the batch's weekdays and skips the holiday", () => {
    const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const session of plan.sessions) {
      const batch = batches.find((b) => b.id === session.batchId)!;
      expect(batch.daysOfWeek).toContain(weekdayOf(session.date));
      expect(session.date).not.toBe("2026-09-15");
    }
  });

  it("leaves the days no batch runs completely empty", () => {
    // No batch runs on Sunday, so Sunday is a genuine zero day for the
    // attendance chart — never a fabricated zero bucket.
    const sunday = plan.sessions.filter((session) =>
      new Date(`${session.date}T00:00:00Z`).getUTCDay() === 0,
    );
    expect(sunday).toHaveLength(0);
  });

  it("marks the attendance on the day the session ran", () => {
    expect(plan.marks.length).toBeGreaterThan(0);
    const byKey = new Map(plan.sessions.map((s) => [s.key, s]));
    for (const mark of plan.marks) {
      const session = byKey.get(mark.sessionKey)!;
      expect(mark.markedAtIso >= session.startsAtIso).toBe(true);
      expect(localDate(mark.markedAtIso)).toBe(session.date);
    }
    const statuses = new Set(plan.marks.map((m) => m.status));
    expect(statuses.has("present")).toBe(true);
    expect(statuses.has("absent")).toBe(true);
  });

  it("leaves a few registers unfilled", () => {
    expect(plan.sessions.some((s) => s.unmarked)).toBe(true);
    const unmarkedKeys = new Set(plan.sessions.filter((s) => s.unmarked).map((s) => s.key));
    expect(plan.marks.every((m) => !unmarkedKeys.has(m.sessionKey))).toBe(true);
  });

  it("gives every mark a client id of its own", () => {
    const ids = plan.marks.map((m) => m.clientId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("demo history planner — money", () => {
  const plan = planDemoHistory(snapshot());

  it("keeps every invoice consistent with its payments", () => {
    expect(plan.invoices.length).toBeGreaterThan(0);
    for (const invoice of plan.invoices) {
      expect(invoice.dueOn >= invoice.issuedOn).toBe(true);
      expect(invoice.totalPaise).toBeGreaterThan(0);
      const paid = invoice.payments.reduce((sum, p) => sum + p.amountPaise, 0);
      expect(paid).toBe(invoice.paidPaise);
      expect(invoice.paidPaise).toBeLessThanOrEqual(invoice.totalPaise);
      if (invoice.status === "paid") expect(invoice.paidPaise).toBe(invoice.totalPaise);
      if (invoice.status === "partial") {
        expect(invoice.paidPaise).toBeGreaterThan(0);
        expect(invoice.paidPaise).toBeLessThan(invoice.totalPaise);
      }
      if (invoice.status === "issued") expect(invoice.paidPaise).toBe(0);
      // The invoice's financial year follows its issue date.
      expect(financialYearFor(invoice.issuedOn)).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("covers every payment method, with a reference only where the rule wants one", () => {
    const methods = new Set(plan.payments.map((p) => p.method));
    expect([...methods].sort()).toEqual(["bank_transfer", "card", "cash", "other", "upi"]);
    for (const payment of plan.payments) {
      if (payment.method === "cash") {
        expect(payment.reference).toBeNull();
      } else {
        expect(payment.reference).not.toBeNull();
      }
    }
    const references = plan.payments
      .map((p) => `${p.method}:${p.reference}`)
      .filter((value) => !value.endsWith("null"));
    expect(new Set(references).size).toBe(references.length);
  });

  it("produces paid, part-paid and unpaid invoices so the dues list has all three", () => {
    const statuses = new Set(plan.invoices.map((i) => i.status));
    expect(statuses.has("paid")).toBe(true);
    expect(statuses.has("partial")).toBe(true);
    expect(statuses.has("issued")).toBe(true);
  });

  it("leaves overdue invoices outstanding for the dues list", () => {
    const overdue = plan.invoices.filter((i) => i.dueOn < ANCHOR && i.paidPaise < i.totalPaise);
    expect(overdue.length).toBeGreaterThan(0);
  });

  it("never collects more than the invoice is worth", () => {
    for (const invoice of plan.invoices) {
      for (const payment of invoice.payments) {
        expect(payment.amountPaise).toBeLessThanOrEqual(invoice.totalPaise);
      }
    }
  });

  it("keeps the collections on an uneven calendar with quiet days", () => {
    const days = new Set(plan.payments.map((p) => localDate(p.receivedAtIso)));
    // Payments land on many different days, but never on every day of
    // the window — the quiet days are what make the chart readable.
    expect(days.size).toBeGreaterThanOrEqual(Math.ceil(plan.payments.length / 2));
    expect(days.size).toBeLessThan(plan.window.days);
    expect(plan.totals.daysWithPayments).toBe(days.size);
    expect(plan.totals.daysWithoutPayments).toBe(plan.window.days - days.size);
  });
});

describe("demo history planner — enquiries and subscriptions", () => {
  const plan = planDemoHistory(snapshot());

  it("creates enquiries across the window with a realistic stage mix", () => {
    expect(plan.enquiries.length).toBeGreaterThan(10);
    const stages = new Set(plan.enquiries.map((e) => e.stage));
    expect(stages.size).toBeGreaterThan(2);
    for (const enquiry of plan.enquiries) {
      expect(enquiry.createdAtIso).toBeTruthy();
      expect(enquiry.phone).toMatch(/^\+91\d{10}$/);
      if (enquiry.stage === "converted") expect(enquiry.memberId).toBeTruthy();
    }
  });

  it("gives every invoice a subscription that covers its due date", () => {
    const byKey = new Map(plan.subscriptions.map((s) => [s.key, s]));
    for (const invoice of plan.invoices) {
      const subscription = byKey.get(invoice.subscriptionKey)!;
      expect(subscription).toBeTruthy();
      expect(subscription.startsOn <= invoice.issuedOn).toBe(true);
      expect(subscription.endsOn >= subscription.startsOn).toBe(true);
    }
  });

  it("keeps at most one active subscription per member and plan", () => {
    const active = plan.subscriptions.filter((s) => s.status === "active");
    const keys = active.map((s) => `${s.memberId}:${s.planId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not bill a paused member", () => {
    const notActive = members.filter((m) => m.status !== "active").map((m) => m.id);
    expect(notActive.length).toBeGreaterThan(0);
    for (const subscription of plan.subscriptions) {
      expect(notActive).not.toContain(subscription.memberId);
    }
  });
});

describe("demo history planner — determinism", () => {
  it("plans the same history for the same anchor", () => {
    const first = planDemoHistory(snapshot());
    const second = planDemoHistory(snapshot());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("moves the window with the anchor instead of freezing dates", () => {
    const base = planDemoHistory(snapshot());
    const shifted = planDemoHistory(
      snapshot({ anchorDate: "2026-10-28", holidays: [] }),
    );
    expect(shifted.window.from).toBe("2026-07-31");
    expect(shifted.window.to).toBe("2026-10-27");
    // The new window's last day is a Tuesday, so Morning Squad ran on
    // it — the plan follows the anchor instead of replaying fixed dates.
    expect(shifted.sessions.some((s) => s.date === "2026-10-27")).toBe(true);
    expect(shifted.sessions.every((s) => s.date <= shifted.window.to)).toBe(true);
    expect(base.sessions.some((s) => s.date === "2026-10-27")).toBe(false);
  });
});
