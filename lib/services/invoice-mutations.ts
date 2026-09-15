import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { invoices } from "@/db/schema/invoices";
import { subscriptions } from "@/db/schema/subscriptions";
import { membershipPlans } from "@/db/schema/membership-plans";
import { tenants } from "@/db/schema/tenants";
import { auditLog } from "@/db/schema/audit";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// C-32 — invoice mutations. Issue goes through issueInvoiceInTx
// (lib/services/invoice-issue.ts) so the counter flow and the nightly
// renewal job share the money math. Void is the only other mutation,
// refused once any payment exists.

export type InvoiceMutationResult =
  | { ok: true; id: string; invoiceNumber: string }
  | { ok: false; error: string };

const createFromSubscriptionInput = z.object({
  subscriptionId: z.string().uuid(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date.")
    .optional(),
});

// Raise an invoice for a subscription's plan price. This is the only
// counter flow: one line, the plan being sold, GST resolved from the
// subscription's facility + activity and snapshotted.
export async function createInvoiceForSubscription(
  ctx: ActionCtx,
  raw: unknown,
): Promise<InvoiceMutationResult> {
  const parsed = createFromSubscriptionInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid invoice request." };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
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
          eq(membershipPlans.tenantId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(subscriptions.id, parsed.data.subscriptionId),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, error: "Subscription not found." };
    if (!locationVisible(access, row.subscription.locationId)) {
      return { ok: false, error: "Subscription not found." };
    }
    if (row.subscription.status !== "active") {
      return {
        ok: false,
        error: "Only an active subscription can be invoiced.",
      };
    }

    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const issuedOn = todayInZone(tenantRow?.timezone ?? "Asia/Kolkata");

    const result = await issueInvoiceInTx(
      tx,
      {
        tenantId: ctx.tenantId,
        memberId: row.subscription.memberId,
        locationId: row.subscription.locationId,
        subscriptionId: row.subscription.id,
        issuedOn,
        dueOn: parsed.data.dueOn ?? issuedOn,
        lines: [
          {
            description: row.planName,
            amountPaise: Number(row.planAmountPaise),
            activityId: row.subscription.activityId,
          },
        ],
      },
      ctx.userId ?? null,
    );
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      id: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
    };
  });
}

export async function voidInvoice(
  ctx: ActionCtx,
  invoiceId: string,
  reason: string,
): Promise<InvoiceMutationResult> {
  const trimmed = z.string().trim().min(3).max(300).safeParse(reason);
  if (!trimmed.success) {
    return { ok: false, error: "Give a reason (3-300 characters)." };
  }
  // Void is a counter action; without an actor there is nobody to
  // attribute the void to, and the audit row below is mandatory.
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .for("update");
    const invoice = rows[0];
    if (!invoice || !locationVisible(access, invoice.locationId)) {
      return { ok: false, error: "Invoice not found." };
    }
    if (invoice.status === "void") {
      return { ok: false, error: "This invoice is already void." };
    }
    if (Number(invoice.paidPaise) > 0) {
      return {
        ok: false,
        error: "Payments are recorded against this invoice; it cannot be voided.",
      };
    }

    await tx
      .update(invoices)
      .set({ status: "void", updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      );

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorId,
      action: "invoice.void",
      entityType: "invoice",
      entityId: invoiceId,
      before: { status: invoice.status },
      after: { status: "void", reason: trimmed.data },
    });

    return { ok: true, id: invoiceId, invoiceNumber: invoice.invoiceNumber };
  });
}
