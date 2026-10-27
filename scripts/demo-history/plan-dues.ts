import { addDays, zonedWallTimeToInstant } from "@/lib/time/tz";
import { hash01 } from "./keys";
import {
  INVOICE_DUE_DAYS,
  INVOICE_LEAD_DAYS,
  OUTCOME_PATTERN,
  PAYMENT_METHOD_PATTERN,
  PAYMENT_WALL_TIMES,
  type PaymentOutcome,
} from "./catalogue";
import type {
  PlannedInvoice,
  PlannedPayment,
  PlannedSubscription,
  TenantSnapshot,
} from "./types";

// The dues cycle.
//
// Every member's membership runs on their own cycle, so the dues — and
// the money that settles them — land on different weekdays and the
// collections curve is never flat. Each cycle produces one invoice, and
// each invoice is paid in full, paid late, part-paid, paid in two
// instalments or left open.
//
// Two rules the planner never bends:
//   * nothing is dated after "now" — a payment that has not happened
//     yet does not exist;
//   * an invoice's paid amount is exactly the sum of its payments, so
//     the dues list and the ledger can never disagree.

export type DuesPlan = {
  subscriptions: PlannedSubscription[];
  invoices: PlannedInvoice[];
  payments: PlannedPayment[];
};

export function planDues(args: {
  snapshot: TenantSnapshot;
  anchorDate: string;
  windowFrom: string;
  nowMs: number;
}): DuesPlan {
  const { snapshot, anchorDate, windowFrom, nowMs } = args;
  const timezone = snapshot.timezone;
  const subscriptions: PlannedSubscription[] = [];
  const invoices: PlannedInvoice[] = [];
  const payments: PlannedPayment[] = [];

  const monthlyPlan =
    snapshot.plans.find((plan) => plan.durationDays === 30) ?? snapshot.plans[0];
  const quarterlyPlan =
    snapshot.plans.find((plan) => plan.durationDays === 90) ?? monthlyPlan;
  const annualPlan = snapshot.plans.find((plan) => (plan.durationDays ?? 0) > 90);

  const billable = snapshot.members.filter((member) => member.status === "active");

  // Per-tenant offsets so two tenants do not share the same rotation.
  const methodOffset = Math.floor(
    hash01(`method-offset|${snapshot.tenantId}`) * PAYMENT_METHOD_PATTERN.length,
  );
  const outcomeOffset = Math.floor(
    hash01(`outcome-offset|${snapshot.tenantId}`) * OUTCOME_PATTERN.length,
  );
  let invoiceCounter = 0;
  let paymentCounter = 0;

  billable.forEach((member, index) => {
    const profile =
      annualPlan && index % 5 === 1
        ? "annual"
        : index % 5 === 0
          ? "quarterly"
          : "monthly";
    const plan =
      profile === "annual"
        ? annualPlan!
        : profile === "quarterly"
          ? quarterlyPlan
          : monthlyPlan;
    if (!plan) return;
    const termLength = plan.durationDays ?? 30;

    // Every member's cycle is on their own day, so the dues land on
    // different weekdays and the collections curve is never flat.
    //
    // The invoice for a cycle goes out a week BEFORE the cycle starts
    // (the renewal invoice an owner actually sends), and is due a week
    // after the cycle starts. Money then arrives over the fortnight that
    // follows — some on the day it was raised, some late.
    const cycleStart =
      profile === "monthly"
        ? addDays(anchorDate, -(index % 30))
        : addDays(anchorDate, -(index % 90));
    const firstStartsOn = addDays(cycleStart, -INVOICE_LEAD_DAYS);

    const termStarts: string[] = [];
    for (
      let start = firstStartsOn;
      start > windowFrom;
      start = addDays(start, -termLength)
    ) {
      termStarts.unshift(start);
    }

    for (const termStart of termStarts) {
      const subscriptionKey = `${member.id}|${plan.id}|${termStart}`;
      const endsOn = addDays(termStart, termLength - 1);
      subscriptions.push({
        key: subscriptionKey,
        memberId: member.id,
        memberCode: member.code,
        planId: plan.id,
        planName: plan.name,
        startsOn: termStart,
        endsOn,
        status: endsOn >= anchorDate ? "active" : "expired",
        amountPaise: plan.amountPaise,
        autoRenew: profile === "monthly",
      });

      const issuedOn = termStart;
      const dueOn = addDays(issuedOn, INVOICE_DUE_DAYS);
      const invoiceKey = `${subscriptionKey}|${issuedOn}`;
      const totalPaise = plan.amountPaise;

      // The outcome rotation advances with the invoice, so consecutive
      // invoices walk the whole pattern.
      const outcomeFor: PaymentOutcome =
        OUTCOME_PATTERN[
          (invoiceCounter + outcomeOffset) % OUTCOME_PATTERN.length
        ]!;
      invoiceCounter += 1;

      const invoicePayments: PlannedPayment[] = [];
      const addPayment = (
        amountPaise: number,
        at: Date,
        instalment: number,
      ) => {
        if (at.getTime() > nowMs) return;
        // The method follows the PAYMENT, not the invoice: consecutive
        // payments walk the pattern (with a stride, so all five methods
        // appear within the first handful of payments), and the weights
        // hold over any nine of them.
        const method =
          PAYMENT_METHOD_PATTERN[
            (paymentCounter * 4 + methodOffset) %
              PAYMENT_METHOD_PATTERN.length
          ]!;
        paymentCounter += 1;
        const reference =
          method === "cash"
            ? null
            : `DEMO-${member.code}-${issuedOn.replace(/-/g, "")}${
                instalment > 0 ? `-${instalment}` : ""
              }`;
        invoicePayments.push({
          key: `${invoiceKey}|pay${instalment}`,
          invoiceKey,
          memberId: member.id,
          amountPaise,
          method,
          receivedAtIso: at.toISOString(),
          reference,
        });
      };

      const wallTimeFor = (salt: string) =>
        PAYMENT_WALL_TIMES[
          Math.floor(hash01(`${invoiceKey}|${salt}`) * PAYMENT_WALL_TIMES.length)
        ]!;
      const dayOffsetFor = (salt: string, span: number) =>
        Math.floor(hash01(`${invoiceKey}|${salt}`) * span);

      // Only an invoice that is already due can carry a payment; a fresh
      // one (due in the future) stays open.
      if (dueOn <= anchorDate) {
        const outcome = outcomeFor;
        if (outcome === "paid") {
          // Paid in full — most of the time within the week the invoice
          // was raised, sometimes a little later.
          const on = addDays(issuedOn, dayOffsetFor("d", 6));
          addPayment(
            totalPaise,
            zonedWallTimeToInstant(on, wallTimeFor("t"), timezone),
            0,
          );
        } else if (outcome === "partial") {
          // Part-paid: the balance stays open and shows up as a due.
          const amount = Math.round(
            totalPaise * (0.4 + dayOffsetFor("p", 30) / 100),
          );
          const on = addDays(issuedOn, dayOffsetFor("d", 6));
          addPayment(
            amount,
            zonedWallTimeToInstant(on, wallTimeFor("t"), timezone),
            0,
          );
        } else if (outcome === "late") {
          // Paid late — after the due date, still inside the window.
          const on = addDays(dueOn, 1 + dayOffsetFor("d", 9));
          addPayment(
            totalPaise,
            zonedWallTimeToInstant(on, wallTimeFor("t"), timezone),
            0,
          );
        } else if (outcome === "split") {
          // Two instalments — a part payment, then the rest.
          const first = Math.round(
            totalPaise * (0.4 + dayOffsetFor("p", 20) / 100),
          );
          const firstOn = addDays(issuedOn, dayOffsetFor("d", 4));
          addPayment(
            first,
            zonedWallTimeToInstant(firstOn, wallTimeFor("t1"), timezone),
            0,
          );
          const secondOn = addDays(firstOn, 7 + dayOffsetFor("d2", 6));
          addPayment(
            totalPaise - first,
            zonedWallTimeToInstant(secondOn, wallTimeFor("t2"), timezone),
            1,
          );
        }
        // The rest stay unpaid — an overdue invoice in the dues list.
      }

      const paidPaise = invoicePayments.reduce((sum, p) => sum + p.amountPaise, 0);
      invoices.push({
        key: invoiceKey,
        subscriptionKey,
        memberId: member.id,
        memberCode: member.code,
        planId: plan.id,
        planName: plan.name,
        issuedOn,
        dueOn,
        totalPaise,
        paidPaise,
        status:
          paidPaise === totalPaise ? "paid" : paidPaise > 0 ? "partial" : "issued",
        description: `${plan.name} — ${termStart} to ${addDays(termStart, termLength - 1)}`,
        payments: invoicePayments,
      });
      payments.push(...invoicePayments);
    }
  });

  return { subscriptions, invoices, payments };
}
