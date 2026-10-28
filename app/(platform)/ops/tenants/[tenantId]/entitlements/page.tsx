import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { withoutTestArtifactFeatureKeys } from "@/lib/feature-artifacts";
import { TenantFeatureToggles } from "../tenant-feature-toggles";
import { SectionHeader } from "../tenant-detail-shared";

// PR4 (ops console improvements) — Entitlements tab: which features
// this tenant has, resolved from the plan with per-tenant overrides.
// Moved out of the Overview page's collapsed "Feature state" section
// (2026-09-13 audit X-D6) — no longer collapsed by default, since it
// now has a tab of its own rather than competing for scroll space.
//
// Ops redesign (28 October 2026): the write permission is resolved on
// the server from the session role, so a viewer sees the resolved
// entitlement and the reason it cannot change it — never a toggle that
// would fail on submit.
export default async function TenantEntitlementsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");
  const canWrite = auth.role === "admin";

  const { tenantId } = await params;
  requireUuidParam(tenantId);
  const detail = await getTenantDetail(asTenantId(tenantId));
  if (!detail) notFound();

  // X-D4 (2026-09-13 audit) — hide test-fixture feature keys that the
  // resolution suites leave in the shared dev database; see
  // lib/feature-artifacts.ts.
  const featureRows = withoutTestArtifactFeatureKeys(
    detail.featureKeys.map((f) => {
      const out: {
        key: string;
        source: "plan" | "tenant_override" | "denied";
        expiresAt?: Date;
      } = { key: f.key, source: f.source };
      if (f.expiresAt) out.expiresAt = f.expiresAt;
      return out;
    }),
  );

  return (
    <section>
      <SectionHeader
        title="Entitlements"
        subtitle="Resolved from the plan; per-tenant overrides toggle each row on or off (and may carry an expiry)."
      />
      <TenantFeatureToggles
        tenantId={detail.id}
        initial={featureRows}
        canWrite={canWrite}
      />
    </section>
  );
}
