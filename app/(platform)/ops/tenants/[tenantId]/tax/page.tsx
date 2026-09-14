import Link from "next/link";
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
    <div className="max-w-3xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/ops/tenants"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Tenants
        </Link>
        {" / "}
        <Link
          href={`/ops/tenants/${tenantId}`}
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          tenant
        </Link>
        {" / "}
        GST
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        GST rates
      </h1>
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
