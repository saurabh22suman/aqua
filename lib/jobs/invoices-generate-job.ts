import { and, eq, gte, lte, ne } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { subscriptions } from "@/db/schema/subscriptions";
import { membershipPlans } from "@/db/schema/membership-plans";
import { invoices } from "@/db/schema/invoices";
import { issueInvoiceInTx, RENEWAL_WINDOW_DAYS } from "@/lib/services/invoice-issue";
import { addDays, todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// C-47 — invoices.generate. Raises the next period's invoice for an
// active subscription that has opted into auto-renew
// (`subscriptions.auto_renew`), when its inclusive end date is inside
// the renewal window. The invoice is due the day after the current
// period ends.
//
// Idempotent two ways: the pre-check skips a subscription that already
// has a live invoice for that due date, and the unique index
// invoices_subscription_due_live_uidx is the backstop if two runs
// race. Nothing is raised for a subscription that hasn't opted in —
// an invoice nobody agreed to pay is worse than no invoice.
export async function runInvoicesGenerateJob(
  tenantId: TenantId,
): Promise<void> {
  const result = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row || (row.status !== "trial" && row.status !== "active")) {
      return { candidates: 0, issued: 0, skipped: 0, failed: 0 };
    }

    const today = todayInZone(row.timezone);
    const horizon = addDays(today, RENEWAL_WINDOW_DAYS);

    const due = await tx
      .select({
        subscription: subscriptions,
        planName: membershipPlans.name,
        planAmountPaise: membershipPlans.amountPaise,
      })
      .from(subscriptions)
      .innerJoin(
        membershipPlans,
        and(
          eq(membershipPlans.id, subscriptions.planId),
          eq(membershipPlans.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, "active"),
          eq(subscriptions.autoRenew, true),
          gte(subscriptions.endsOn, today),
          lte(subscriptions.endsOn, horizon),
        ),
      );

    let issued = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of due) {
      const subscription = item.subscription;
      const dueOn = addDays(subscription.endsOn, 1);

      const existing = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.subscriptionId, subscription.id),
            eq(invoices.dueOn, dueOn),
            ne(invoices.status, "void"),
          ),
        )
        .limit(1);
      if (existing[0]) {
        skipped += 1;
        continue;
      }

      const issuedResult = await issueInvoiceInTx(
        tx,
        {
          tenantId,
          memberId: subscription.memberId,
          locationId: subscription.locationId,
          subscriptionId: subscription.id,
          issuedOn: today,
          dueOn,
          lines: [
            {
              description: item.planName,
              amountPaise: Number(item.planAmountPaise),
              activityId: subscription.activityId,
            },
          ],
        },
        null,
      );
      if (issuedResult.ok) issued += 1;
      else failed += 1;
    }

    return { candidates: due.length, issued, skipped, failed };
  });

  console.log(
    `[invoices.generate] tenant ${tenantId}: ${result.issued} raised, ` +
      `${result.skipped} already present, ${result.failed} failed ` +
      `(${result.candidates} candidate(s))`,
  );
}
