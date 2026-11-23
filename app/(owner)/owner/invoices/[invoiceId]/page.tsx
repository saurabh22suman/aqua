import { notFound } from "next/navigation";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getInvoiceAction } from "@/lib/actions/invoices";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { InvoiceDetailSurface } from "@/components/fees/invoice-detail-surface";

export default async function OwnerInvoicePage({params}: {params: Promise<{invoiceId:string}>}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "invoices.read");
  const {invoiceId} = await params;
  const invoice = await getInvoiceAction(invoiceId);
  if (!invoice) notFound();
  // The only return path is the ledger for the club this authorized read
  // actually names. A caller-supplied return URL is deliberately not read.
  const ledgerHref = `/owner/fees?${new URLSearchParams({
    tab: "invoices",
    facility: invoice.locationId,
  })}`;
  return <OwnerPage workflow="ledger" data-owner-money-page="invoice">
    <BackLink href={ledgerHref} label="Invoice ledger" />
    <PageHeader
      title={`Invoice ${invoice.invoiceNumber}`}
      purpose={
        <span>
          <span className="font-medium text-ink-2">{invoice.payerName}</span>
          {" · "}
          {invoice.locationName}
        </span>
      }
    />
    <div className="mt-4 rounded-card border border-line bg-paper p-4 sm:p-5">
      <InvoiceDetailSurface invoiceId={invoice.id} canWrite={hasPermission(ctx,"invoices.write")} canVoid={hasPermission(ctx,"settings.manage")} canRecord={hasPermission(ctx,"payments.record")} canRefund={hasPermission(ctx,"payments.refund")} canReadPayments={hasPermission(ctx,"payments.read")} />
    </div>
  </OwnerPage>;
}
