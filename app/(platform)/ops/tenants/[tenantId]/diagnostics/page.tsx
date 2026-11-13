import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { runOpsRead } from "@/lib/auth/ops-operation";
import { getTenantDiagnostics } from "@/db/ops-diagnostics-view";
import { asTenantId } from "@/lib/ids";
import { OpsPage, OpsPageHeader, OpsPanel, OpsSection } from "@/components/ops/ops-primitives";
import {
  DiagnosticsEntitlements,
  DiagnosticsMembershipDetail,
  DiagnosticsMembershipList,
  DiagnosticsRefusal,
  DiagnosticsScopeNotice,
} from "./diagnostics-sections";

export const dynamic = "force-dynamic";

const MEMBERSHIP_ID = z.string().uuid();

export default async function TenantAccountDiagnosticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ membership?: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") redirect("/ops/login");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  // A viewer is refused BEFORE any read, the way /ops/recovery refuses
  // one. The refusal renders no club data at all.
  if (status.role !== "admin") return <DiagnosticsRefusal />;

  const { tenantId } = await params;
  const { membership } = await searchParams;

  // The ONLY thing the query string may choose is WHICH of this club's
  // memberships to describe. A malformed selection is simply no
  // selection; it is never echoed back.
  const membershipId =
    typeof membership === "string" && MEMBERSHIP_ID.safeParse(membership).success
      ? membership
      : null;

  // The operation boundary owns the UUID guard: a malformed segment is
  // refused before the read and answers the same friendly 404.
  const view = await runOpsRead(
    "tenant.diagnostics.read",
    tenantId,
    () => getTenantDiagnostics(asTenantId(tenantId), { membershipId }),
    "ops_page",
  );
  if (!view) notFound();

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Tenant"
        title="Account diagnostics"
        lede="Each staff membership’s role, grants and facilities, with destination assessment where available."
        meta="Live read · never cached"
      />

      <DiagnosticsScopeNotice />

      <section className="mt-8">
        <OpsSection
          title="Staff memberships"
          subtitle="The club's own membership rows, newest first. The id names the membership row, not a person."
          actions={
            <span className="text-[12px] text-ink-3">
              {view.total} {view.total === 1 ? "membership" : "memberships"}
            </span>
          }
        />
        <DiagnosticsMembershipList
          memberships={view.memberships}
          total={view.total}
          tenantId={tenantId}
        />
      </section>

      {view.selected ? (
        <section className="mt-8">
          <OpsSection
            title="The account under diagnosis"
            subtitle="Its role, grants, facilities and available destination assessment."
          />
          <DiagnosticsMembershipDetail membership={view.selected} />
        </section>
      ) : membershipId ? (
        <OpsPanel
          tone="warn"
          className="mt-8"
          title="That membership is not in this club"
        >
          No membership with that id belongs to this club, so there is nothing to
          describe.
        </OpsPanel>
      ) : null}

      <section className="mt-8">
        <OpsSection
          title="Effective entitlements"
          subtitle="What this club has switched on, where the switch came from, and when a temporary one expires."
        />
        <DiagnosticsEntitlements entitlements={view.entitlements} />
      </section>
    </OpsPage>
  );
}
