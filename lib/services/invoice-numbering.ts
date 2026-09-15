import { and, eq } from "drizzle-orm";
import { invoiceNumberCounters } from "@/db/schema/invoice-numbering";
import { formatInvoiceNumber, financialYearFor } from "@/lib/invoice-numbering";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";

// C-31 — allocate the next invoice number inside the caller's invoice
// transaction. Gapless by construction:
//   1. ensure the (tenant, financial year) counter row exists;
//   2. lock it with `select … for update` (concurrent invoices for the
//      same tenant+FY serialize here);
//   3. take the current value and increment.
// A rollback releases the lock and leaves next_number untouched, so no
// number is ever burned — the exact property a sequence cannot give.

export async function allocateInvoiceNumber(
  tx: TenantTx,
  tenantId: TenantId,
  issuedOn: string,
): Promise<{ invoiceNumber: string; financialYear: string; serial: number }> {
  const financialYear = financialYearFor(issuedOn);

  await tx
    .insert(invoiceNumberCounters)
    .values({ tenantId, financialYear, nextNumber: 1 })
    .onConflictDoNothing();

  const rows = await tx
    .select({ nextNumber: invoiceNumberCounters.nextNumber })
    .from(invoiceNumberCounters)
    .where(
      and(
        eq(invoiceNumberCounters.tenantId, tenantId),
        eq(invoiceNumberCounters.financialYear, financialYear),
      ),
    )
    .for("update");
  const current = rows[0];
  if (!current) {
    // Unreachable after the insert above unless RLS hid the row.
    throw new Error(
      `allocateInvoiceNumber: counter missing for ${tenantId}/${financialYear}`,
    );
  }

  const serial = current.nextNumber;
  await tx
    .update(invoiceNumberCounters)
    .set({ nextNumber: serial + 1, updatedAt: new Date() })
    .where(
      and(
        eq(invoiceNumberCounters.tenantId, tenantId),
        eq(invoiceNumberCounters.financialYear, financialYear),
      ),
    );

  return {
    invoiceNumber: formatInvoiceNumber(financialYear, serial),
    financialYear,
    serial,
  };
}
