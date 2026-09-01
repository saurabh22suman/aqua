import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listActivePlans } from "@/db/platform-tenant-create";
import { NewTenantForm } from "./new-tenant-form";

// Phase 1.5 — create-tenant page. Sits under /platform/tenants/new;
// the listing page at /platform/tenants already links here with a
// verb CTA. The page is server-rendered: auth-gate, fetch the active
// plan list for the <select>, hand off to a client form for the
// submit-and-redirect flow.

export default async function NewTenantPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/platform/login");

  const plans = await listActivePlans();
  const defaultPlan = plans.find((p) => p.isDefault) ?? plans[0];

  return (
    <div className="max-w-3xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Tenants
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        New tenant
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Creates the tenant record, its first location, and an audit trail in a
        single transaction. Default values are sensible for an India-based
        sports academy.
      </p>

      <NewTenantForm
        defaultTimezone="Asia/Kolkata"
        defaultCurrency="INR"
        defaultLocationName="Main"
        plans={plans}
        defaultPlanKey={defaultPlan?.key ?? "standard"}
      />
    </div>
  );
}
