import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listActivePlans } from "@/db/platform-tenant-create";
import { listPresets } from "@/db/platform-presets";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { NewTenantForm } from "./new-tenant-form";
import { OpsPage, OpsPageHeader } from "@/components/ops/ops-primitives";
import { OpsWriteGate } from "@/components/ops/ops-display";

// Phase 1.5 — create-tenant page. Sits under /ops/tenants/new;
// the listing page at /ops/tenants already links here with a
// verb CTA. The page is server-rendered: auth-gate, fetch the active
// plan list for the <select>, hand off to a client form for the
// submit-and-redirect flow.
//
// Ops redesign (28 October 2026): the page is the shared Ops frame.
//
// The editor is a SINGLE column of about 640px — one field per row,
// the width of a comfortable form. (The new-lead form keeps its
// purposeful two columns at 760px; that one has short fields side by
// side, and the reviewer asked for it to stay.)
export default async function NewTenantPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  const plans = await runOpsGlobalRead(
    "plan.list",
    () => listActivePlans(),
    "ops_page",
  );
  if (!plans) redirect("/ops/login");
  const defaultPlan = plans.find((p) => p.isDefault) ?? plans[0];
  // PR1-C6 — an explicit preset choice. Without one the tenant is
  // created with preset_key null and no sample data, which used to
  // happen silently. The service still tolerates a missing preset
  // (and warns); this form does not.
  const allPresets = await runOpsGlobalRead(
    "preset.list",
    () => listPresets(),
    "ops_page",
  );
  if (!allPresets) redirect("/ops/login");
  const presets = allPresets.filter((p) => p.status === "active");
  const defaultPreset =
    presets.find((p) => p.key === "start-from-scratch") ?? presets[0];

  return (
    <OpsPage className="max-w-[640px]">
      <OpsPageHeader
        eyebrow="Tenants"
        title="New tenant"
        lede="Creates the tenant record, its first location, and an audit trail in a single transaction. Default values are sensible for an India-based sports academy."
      />

      <OpsWriteGate
        canWrite={canWrite}
        note={
          <>
            Read-only: this account can browse, not change, platform data. An
            administrator creates a tenant.
          </>
        }
      >
        <NewTenantForm
          defaultTimezone="Asia/Kolkata"
          defaultCurrency="INR"
          defaultLocationName="Main"
          plans={plans}
          defaultPlanKey={defaultPlan?.key ?? "standard"}
          presets={presets.map((p) => ({
            key: p.key,
            name: p.name,
            description: p.description,
          }))}
          defaultPresetKey={defaultPreset?.key ?? ""}
        />
      </OpsWriteGate>
    </OpsPage>
  );
}
