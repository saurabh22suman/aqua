"use client";

import { useRouter } from "next/navigation";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";

export function InvoiceDetailSurface(props: {
  invoiceId: string; canWrite: boolean; canVoid: boolean; canRecord: boolean; canRefund: boolean; canReadPayments: boolean;
}) {
  const router = useRouter();
  return <InvoiceExpanded {...props} onChanged={() => router.refresh()} />;
}
