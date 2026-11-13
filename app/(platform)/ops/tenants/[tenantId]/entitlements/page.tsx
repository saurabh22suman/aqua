import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { listFeatures } from "@/db/platform-features";
import { asTenantId } from "@/lib/ids";
import { runOpsGlobalRead, runOpsRead } from "@/lib/auth/ops-operation";
import { withoutTestArtifactFeatureKeys } from "@/lib/feature-artifacts";
import { TenantFeatureToggles } from "../tenant-feature-toggles";
import { SectionHeader } from "../tenant-detail-shared";

export default async function TenantEntitlementsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");
  const canWrite = auth.role === "admin";

  const { tenantId } = await params;
  const detail = await runOpsRead(
    "tenant.detail",
    tenantId,
    () => getTenantDetail(asTenantId(tenantId)),
    "ops_page",
  );
  if (!detail) notFound();

  // The WHOLE catalogue, read through the same audited boundary the
  // catalogue screen uses. A feature the club's plan does not carry
  // must still be OFFERED: the write path (upsertTenantFeature) and
  // the runtime resolution both accept a per-tenant grant of a
  // catalogue key, so the editor was the only thing standing between
  // an operator and that grant.
  const catalogue = await runOpsGlobalRead(
    "feature.catalogue.list",
    () => listFeatures(),
    "ops_page",
  );
  if (!catalogue) redirect("/ops/login");

  // The tenant's OWN facts — enabled, denied, the source and the
  // expiry — are kept exactly as they are. The catalogue only ADDS the
  // features the tenant does not hold yet, and only the ones an
  // operator may grant (GA and Beta). An internal feature the tenant
  // already resolves stays visible: hiding a visible fact would be a
  // lie, and a mandatory core module keeps its read-only row.
  const held = new Set(detail.featureKeys.map((f) => f.key));
  const grantable = catalogue.filter(
    (feature) => feature.status === "ga" || feature.status === "beta",
  );
  const merged = [
    ...detail.featureKeys.map((f) => ({
      key: f.key,
      source: f.source,
      expiresAt: f.expiresAt,
    })),
    ...grantable
      .filter((feature) => !held.has(feature.key))
      .map((feature) => ({ key: feature.key, source: "denied" as const, expiresAt: undefined })),
  ].sort((a, b) => a.key.localeCompare(b.key));

  // X-D4 (2026-09-13 audit) — hide test-fixture feature keys that the
  // resolution suites leave in the shared dev database; see
  // lib/feature-artifacts.ts.
  const featureRows = withoutTestArtifactFeatureKeys(
    merged.map((f) => {
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
        subtitle="Every GA and Beta feature is listed, so one this club's plan does not carry can still be granted for it. Per-tenant overrides toggle each row on or off (and may carry an expiry)."
      />
      <TenantFeatureToggles
        tenantId={detail.id}
        initial={featureRows}
        canWrite={canWrite}
      />
    </section>
  );
}
