"use client";

import { useRouter } from "next/navigation";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";

// The standalone owner document route opts into the balance-first
// presentation. Inline consumers (dues ledger, reception member detail)
// keep their existing compact presentation untouched.
export function InvoiceDetailSurface(props: {
  invoiceId: string; canWrite: boolean; canVoid: boolean; canRecord: boolean; canRefund: boolean; canReadPayments: boolean;
}) {
  const router = useRouter();
  return <InvoiceExpanded {...props} presentation="standalone" onChanged={() => router.refresh()} />;
}
