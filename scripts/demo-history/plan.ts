import { addDays, todayInZone, weekdayOf, zonedWallTimeToInstant } from "@/lib/time/tz";
import { hash01 } from "./keys";
import { planDues } from "./plan-dues";
import { planEnquiries } from "./plan-enquiries";
import type {
  HistoryPlan,
  HistoryPlanTotals,
  PlannedMark,
  PlannedSession,
  TenantSnapshot,
} from "./types";
import type { PaymentMethodKey } from "@/lib/money/payment-groups";

// The demo-history planner.
//
// PURE: it reads a snapshot of the tenant (members, batches, plans,
// holidays) and returns the history it would write. No clock beyond the
// snapshot's anchor, no I/O, no randomness beyond a deterministic hash.
// That is what makes the generator reproducible — and testable without a
// database.
//
// The shape of the history is deliberately uneven, because a chart that
// shows a smooth line teaches a reviewer nothing:
//
//   * sessions run only on the batch's own weekdays, so Sundays (no
//     batch runs on Sunday) and holidays are genuine zero days;
//   * roughly one register in fourteen is never filled in, so an
//     attendance bucket can honestly be "unknown" rather than 0%;
//   * dues are billed on each member's own 30/90/365-day cycle, so
//     money lands on different weekdays for different members;
//   * invoices are paid in full, paid late, part-paid, paid in two
//     instalments or left unpaid, and the method (cash / UPI / card /
//     bank transfer / other) varies per payment.
//
// Nothing here is a chart value: the planner writes ordinary rows and
// the application's own reads produce the charts.
//
// The plan is split by what it plans: the sessions and the registers
// (here), the dues cycle (plan-dues.ts) and the enquiries
// (plan-enquiries.ts).

export function planDemoHistory(snapshot: TenantSnapshot): HistoryPlan {
  const { timezone, anchorDate, windowDays } = snapshot;
  const windowFrom = addDays(anchorDate, -(windowDays - 1));
  const windowTo = addDays(anchorDate, -1);
  const nowMs = Date.parse(snapshot.nowIso);
  if (Number.isNaN(nowMs)) {
    throw new Error(`planDemoHistory: invalid nowIso "${snapshot.nowIso}"`);
  }

  const memberById = new Map(
    snapshot.members.map((member) => [member.id, member]),
  );

  // ---------------------------------------------------------------- sessions
  const sessions: PlannedSession[] = [];
  const marks: PlannedMark[] = [];

  for (const batch of snapshot.batches) {
    // A batch with nobody enrolled has no register to fill.
    if (batch.memberIds.length === 0) continue;
    for (let back = windowDays - 1; back >= 0; back--) {
      const date = addDays(anchorDate, -(back + 1));
      if (!batch.daysOfWeek.includes(weekdayOf(date))) continue;
      if (snapshot.holidays.includes(date)) continue;

      const startsAt = zonedWallTimeToInstant(date, batch.startTime, timezone);
      const endsAt = zonedWallTimeToInstant(date, batch.endTime, timezone);
      const markedAt = new Date(endsAt.getTime() + 5 * 60_000);
      const key = `${batch.id}|${date}`;
      // One register in fourteen is never filled in.
      const unmarked = hash01(`${batch.id}|${date}|register`) < 0.07;

      sessions.push({
        key,
        batchId: batch.id,
        batchName: batch.name,
        date,
        startsAtIso: startsAt.toISOString(),
        endsAtIso: endsAt.toISOString(),
        markedAtIso: markedAt.toISOString(),
        locationId: batch.locationId,
        coachId: batch.coachId,
        unmarked,
      });
      if (unmarked) continue;

      for (const memberId of batch.memberIds) {
        const member = memberById.get(memberId);
        if (!member) continue;
        if (member.status === "left" || member.status === "lapsed") continue;
        marks.push({
          key: `${key}|${memberId}`,
          sessionKey: key,
          sessionDate: date,
          memberId,
          memberCode: member.code,
          status: attendanceStatus(member, date),
          markedAtIso: markedAt.toISOString(),
          clientId: `demo-hist-${date}-${member.code}-${batch.id.slice(0, 8)}`,
        });
      }
    }
  }

  // ------------------------------------------------------- money: dues cycle
  const dues = planDues({ snapshot, anchorDate, windowFrom, nowMs });

  // ------------------------------------------------------------- enquiries
  const enquiries = planEnquiries({ snapshot, anchorDate, windowDays, nowMs });

  const totals = summarise(
    { timezone, windowDays },
    sessions,
    marks,
    dues.subscriptions,
    dues.invoices,
    dues.payments,
    enquiries.enquiries,
    enquiries.followUps,
  );
  return {
    window: {
      from: windowFrom,
      to: windowTo,
      days: windowDays,
      anchorDate,
      timezone,
    },
    sessions,
    marks,
    subscriptions: dues.subscriptions,
    invoices: dues.invoices,
    payments: dues.payments,
    enquiries: enquiries.enquiries,
    followUps: enquiries.followUps,
    totals,
  };
}

/**
 * Present / late / absent per member per day. A few members attend
 * badly — that is what an absence list is for — and the rest drift
 * around a high attendance.
 */
function attendanceStatus(
  member: { id: string; code: string },
  date: string,
): "present" | "late" | "absent" {
  const r = hash01(`${member.id}|${date}`);
  const unreliable = hash01(`unreliable|${member.code}`) < 0.12;
  if (unreliable) {
    if (r < 0.3) return "absent";
    if (r < 0.45) return "late";
    return "present";
  }
  if (r < 0.08) return "late";
  if (r < 0.17) return "absent";
  return "present";
}

function summarise(
  window: { timezone: string; windowDays: number },
  sessions: PlannedSession[],
  marks: PlannedMark[],
  subscriptions: HistoryPlan["subscriptions"],
  invoices: HistoryPlan["invoices"],
  payments: HistoryPlan["payments"],
  enquiries: HistoryPlan["enquiries"],
  followUps: HistoryPlan["followUps"],
): HistoryPlanTotals {
  const marksByStatus = { present: 0, late: 0, absent: 0 };
  for (const mark of marks) marksByStatus[mark.status] += 1;

  const invoicesByStatus = { paid: 0, partial: 0, issued: 0 };
  for (const invoice of invoices) invoicesByStatus[invoice.status] += 1;

  const paymentsByMethod: Record<PaymentMethodKey, number> = {
    cash: 0,
    upi: 0,
    bank_transfer: 0,
    card: 0,
    other: 0,
  };
  let paymentsPaise = 0;
  const paymentDays = new Set<string>();
  for (const payment of payments) {
    paymentsByMethod[payment.method] += 1;
    paymentsPaise += payment.amountPaise;
    paymentDays.add(
      todayInZone(window.timezone, Date.parse(payment.receivedAtIso)),
    );
  }

  return {
    sessions: sessions.length,
    unmarkedSessions: sessions.filter((session) => session.unmarked).length,
    marks: marks.length,
    marksByStatus,
    subscriptions: subscriptions.length,
    invoices: invoices.length,
    invoicesByStatus,
    payments: payments.length,
    paymentsPaise,
    paymentsByMethod,
    enquiries: enquiries.length,
    followUps: followUps.length,
    daysWithPayments: paymentDays.size,
    daysWithoutPayments: Math.max(0, window.windowDays - paymentDays.size),
  };
}
