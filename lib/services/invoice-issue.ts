import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenants } from "@/db/schema/tenants";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { auditLog } from "@/db/schema/audit";
import { resolveConfigInTx } from "@/db/config";
import { allocateInvoiceNumber } from "@/lib/services/invoice-numbering";
import { GST_RATE_KEY } from "@/lib/services/tax";
import { computeTax } from "@/lib/money/arithmetic";
import { gstDocumentKind } from "@/lib/gst";
import { asMemberId, asTenantId } from "@/lib/ids";
import type { TenantTx } from "@/db/tenant";
import type { UserId } from "@/lib/ids";

// C-32 — issue an invoice inside a caller's transaction. Used by the
// owner/reception flow (lib/services/invoices.ts) and by the nightly
// renewal job (C-47), so the money math lives in exactly one place.
//
// The GSTIN snapshot decides the document kind: a registered tenant
// issues a tax invoice and GST is applied; a tenant without a GSTIN
// issues a bill of supply and no tax is charged. Rates are resolved
// per line (activity + facility) and snapshotted; a later config
// change never rewrites an issued document.

export const SAC_CODE_KEY = "billing.sac_code" as const;
export const RENEWAL_WINDOW_DAYS = 7;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date.");

export const issueInvoiceInputSchema = z.object({
  tenantId: z.string().uuid(),
  memberId: z.string().uuid(),
  locationId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullish(),
  issuedOn: dateSchema,
  dueOn: dateSchema,
  notes: z.string().trim().max(500).nullish(),
  // K-03 — where this document came from. Defaults to the original
  // membership path so existing callers are untouched; café orders
  // pass 'cafe' (lib/services/orders.ts).
  source: z.enum(["membership", "cafe", "other"]).default("membership"),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        amountPaise: z.number().int().positive(),
        activityId: z.string().uuid().nullish(),
        // K-03 — optional per-line snapshots. The café path supplies
        // the order's snapshotted SAC and GST rate so the issued
        // document matches the operational record to the paisa; the
        // membership path leaves them unset and resolves the tenant
        // config as before.
        sacCode: z
          .string()
          .regex(/^\d{4,8}$/, "The SAC code must be 4-8 digits.")
          .nullish(),
        taxRateBp: z.number().int().min(0).max(10000).nullish(),
      }),
    )
    .min(1, "An invoice needs at least one line."),
});

export type IssueInvoiceInput = z.input<typeof issueInvoiceInputSchema>;

export type IssueInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; totalPaise: number }
  | { ok: false; error: string };

export async function issueInvoiceInTx(
  tx: TenantTx,
  raw: IssueInvoiceInput,
  actorId: UserId | null,
): Promise<IssueInvoiceResult> {
  const parsed = issueInvoiceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invoice input.",
    };
  }
  const input = parsed.data;
  const tenantId = asTenantId(input.tenantId);

  if (input.dueOn < input.issuedOn) {
    return { ok: false, error: "The due date cannot precede the issue date." };
  }

  const [tenantRow] = await tx
    .select({ gstin: tenants.gstin })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenantRow) return { ok: false, error: "Tenant not found." };
  const gstin = tenantRow.gstin;
  const documentKind = gstDocumentKind(gstin);

  const { value: sacCode } = await resolveConfigInTx<string>(
    tx,
    tenantId,
    SAC_CODE_KEY,
  );

  const lines: Array<{
    description: string;
    sacCode: string;
    amountPaise: number;
    taxRateBp: number;
    taxPaise: number;
  }> = [];

  for (const line of input.lines) {
    // An explicit snapshot (the café path) is trusted as-is: the
    // order is the operational record of what was sold and at what
    // rate, and the invoice must match it to the paisa. The
    // bill-of-supply rule (no GSTIN ⇒ no tax) is applied where the
    // café snapshot is created (lib/services/orders.ts), so a
    // snapshot from an unregistered tenant already carries rate zero
    // and the two documents never disagree. Otherwise the membership
    // path resolves the tenant's GST config as before.
    let rateBp = 0;
    let lineSacCode = sacCode;
    if (line.taxRateBp !== undefined && line.taxRateBp !== null) {
      rateBp = line.taxRateBp;
      lineSacCode = line.sacCode ?? sacCode;
    } else if (documentKind === "tax_invoice") {
      const resolved = await resolveConfigInTx<number>(
        tx,
        tenantId,
        GST_RATE_KEY,
        {
          locationId: input.locationId,
          activityId: line.activityId ?? undefined,
        },
      );
      rateBp = resolved.value;
    }
    lines.push({
      description: line.description,
      sacCode: lineSacCode,
      amountPaise: line.amountPaise,
      taxRateBp: rateBp,
      taxPaise: computeTax(line.amountPaise, rateBp),
    });
  }

  const subtotalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);
  const taxPaise = lines.reduce((sum, l) => sum + l.taxPaise, 0);
  const totalPaise = subtotalPaise + taxPaise;
  if (totalPaise <= 0) {
    return { ok: false, error: "The invoice total must be positive." };
  }

  const allocated = await allocateInvoiceNumber(
    tx,
    tenantId,
    input.issuedOn,
  );

  const [invoice] = await tx
    .insert(invoices)
    .values({
      tenantId,
      locationId: input.locationId,
      memberId: asMemberId(input.memberId),
      subscriptionId: input.subscriptionId ?? null,
      invoiceNumber: allocated.invoiceNumber,
      financialYear: allocated.financialYear,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
      subtotalPaise: BigInt(subtotalPaise),
      taxPaise: BigInt(taxPaise),
      totalPaise: BigInt(totalPaise),
      status: "issued",
      source: input.source,
      gstin,
      notes: input.notes ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: invoices.id });
  if (!invoice) return { ok: false, error: "The invoice could not be saved." };

  await tx.insert(invoiceLineItems).values(
    lines.map((line) => ({
      tenantId,
      invoiceId: invoice.id,
      description: line.description,
      sacCode: line.sacCode,
      amountPaise: BigInt(line.amountPaise),
      taxRateBp: line.taxRateBp,
      taxPaise: BigInt(line.taxPaise),
    })),
  );

  // E-01 — both paths audit in the same transaction as the insert.
  // A user-issued invoice carries the actor; a system-issued renewal
  // (the invoices.generate job) carries actor_type='system' with no
  // actor_id, which the old NOT NULL column made impossible (F-15
  // job gap).
  await tx.insert(auditLog).values({
    tenantId,
    actorType: actorId ? "user" : "system",
    actorId: actorId ?? null,
    source: actorId ? "web" : "job",
    action: "invoice.issue",
    entityType: "invoice",
    entityId: invoice.id,
    after: {
      invoiceNumber: allocated.invoiceNumber,
      documentKind,
      source: input.source,
      subtotalPaise,
      taxPaise,
      totalPaise,
      subscriptionId: input.subscriptionId ?? null,
    },
  });

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber: allocated.invoiceNumber,
    totalPaise,
  };
}
