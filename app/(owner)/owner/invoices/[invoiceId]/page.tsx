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
  return <OwnerPage>
    <BackLink href="/owner" label="Home" />
    <PageHeader title={`Invoice ${invoice.invoiceNumber}`} purpose={`${invoice.payerName} · ${invoice.locationName}`} />
    <div className="mt-4 rounded-card border border-line bg-paper p-4">
      <InvoiceDetailSurface invoiceId={invoice.id} canWrite={hasPermission(ctx,"invoices.write")} canVoid={hasPermission(ctx,"settings.manage")} canRecord={hasPermission(ctx,"payments.record")} canRefund={hasPermission(ctx,"payments.refund")} canReadPayments={hasPermission(ctx,"payments.read")} />
    </div>
  </OwnerPage>;
}
