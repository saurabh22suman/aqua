import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantTaxConfigAction } from "@/lib/actions/platform-tax";
import { TaxRates } from "./tax-rates";
import { OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";

// GST rates in the ops console: the tenant default, per facility and
// per activity. Plan prices are GST-exclusive; invoices apply and
// snapshot the resolved rate.
//
// Ops redesign (28 October 2026): GST is a TAB in the tenant
// navigation now, not a sentence link inside Configuration — it was
// easy to miss there. The page is the shared Ops frame, and the write
// permission is resolved on the server from the session role.
export default async function TenantTaxPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  const { tenantId } = await params;
  const config = await getTenantTaxConfigAction(tenantId);
  if (!config) notFound();

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="GST"
        title="GST rates"
        lede="The rate applied when invoicing, most specific scope winning. Plan prices are exclusive of GST; invoices snapshot the rate at issue, so changes here never rewrite history."
      />
      <OpsPanel tone="info" className="mt-5" title="Scope order">
        The most specific scope wins: an activity rate beats a facility rate,
        which beats the tenant rate. A rate set here applies to invoices
        raised after it — it never rewrites an invoice already issued.
      </OpsPanel>
      <div className="mt-5">
        <TaxRates tenantId={tenantId} config={config} canWrite={canWrite} />
      </div>
    </OpsPage>
  );
}
