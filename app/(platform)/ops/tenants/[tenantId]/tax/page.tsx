import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantTaxConfigAction } from "@/lib/actions/platform-tax";
import { TaxRates } from "./tax-rates";

// GST rates in the ops console: the tenant default, per facility and
// per activity. Plan prices are GST-exclusive; invoices apply and
// snapshot the resolved rate.

export default async function TenantTaxPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  const config = await getTenantTaxConfigAction(tenantId);
  if (!config) notFound();

  return (
    <div>
      <h2 className="font-display text-[20px] font-semibold text-marine">
        GST rates
      </h2>
      <p className="mt-1 text-[14px] text-ink-2">
        The rate applied when invoicing, most specific scope winning.
        Plan prices are exclusive of GST; invoices snapshot the rate at
        issue, so changes here never rewrite history.
      </p>

      <div className="mt-6">
        <TaxRates tenantId={tenantId} config={config} />
      </div>
    </div>
  );
}
