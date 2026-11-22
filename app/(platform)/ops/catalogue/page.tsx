import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listOpsPlanCatalogue } from "@/db/saas-plan-catalogue";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";
import { PlanCatalogue } from "@/components/ops/commercial/plan-catalogue";
import { buttonClasses } from "@/components/ui/Button";

export default async function OpsCataloguePage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const plans = await runOpsGlobalRead("plan.list", () => listOpsPlanCatalogue(), "ops_page");
  if (!plans) redirect("/ops/login");
  const offered = plans.filter((p) => p.status === "active" && p.availableForNewTenants);
  return (
    <OpsPage>
      <OpsPageHeader title="SaaS plan catalogue"
        lede="Choose a plan for a trial club. Existing clubs keep their plan and access."
        actions={status.role === "admin" && offered.length > 0 ? (
          <Link className={buttonClasses({ variant: "primary", size: "sm" })} href="/ops/tenants/new">
            Create a trial club
          </Link>
        ) : undefined}
        meta={`${offered.length} ${offered.length === 1 ? "plan" : "plans"} · Trial workflow`} />
      <OpsPanel tone="info" className="mt-5" title="Commercial terms not configured">
        <p>Prices, billing periods, feature packaging and enforced limits remain unconfigured. A recorded price is not an agreed offer. All three plans use Standard’s access baseline for local testing; selecting a plan does not charge a club or activate a paid subscription.</p>
      </OpsPanel>
      <PlanCatalogue plans={plans} canCreate={status.role === "admin"} />
    </OpsPage>
  );
}
