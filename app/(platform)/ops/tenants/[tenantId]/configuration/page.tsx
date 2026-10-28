import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getEffectiveConfiguration } from "@/db/ops-configuration-view";
import { listConfigChangeRequests } from "@/db/config-requests";
import { resolveConfigChain } from "@/db/config";
import { getTenantConfigAuditLog } from "@/db/tenant-config-audit";
import { listAllTenantsForSelector } from "@/db/platform-tenants";
import { navForRole } from "@/lib/nav";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import type { ConfigKeyName } from "@/db/config-definitions";
import {
  OpsEmptyState,
  OpsPage,
  OpsSection,
} from "@/components/ops/ops-primitives";
import {
} from "@/components/ops/ops-display";
import { ChangeRequests } from "./change-requests";
import { LocationOverrides, ResolvedValues } from "./resolved-values";
import { NavPreview } from "./nav-preview";
import { PermissionMatrix } from "./permission-matrix";
import { TenantSelector } from "./tenant-selector";
import { ResolutionChain } from "./resolution-chain";

// O-06 (docs/ops-platform-design.md §6) — the effective-configuration
// viewer. Answers "why can't my coach see Reports?" from resolved
// values, entitlements and the permission matrix. No member PII is
// queried by the data layer (db/ops-configuration-view.ts); the test
// suite pins both the source scan and the rendered output.
//
// Ops redesign (28 October 2026):
//
//   - The route now carries the SAME UUID guard as every other tenant
//     route. It did not: a malformed segment reached the query and
//     surfaced as a database error instead of the friendly 404.
//   - The body is the shared Ops frame — one card, one empty state,
//     one status pill — and the role picker is the shared Select.
//   - The GST rates link stays: GST is now a tab in the tenant
//     navigation too, and this sentence link keeps it reachable from
//     the configuration context it belongs to.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

// PR5 — the current URL, with ?key set to this row (and ?role kept as
// is, if a non-default role is selected) — the "Why this value?" link.
function chainHref(key: string, role: string | undefined): string {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  params.set("key", key);
  return `?${params.toString()}`;
}

export default async function EffectiveConfigurationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ role?: string; key?: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  const { tenantId } = await params;
  // The SAME friendly guard every other tenant route carries, applied
  // immediately after the params are awaited and BEFORE any query: a
  // malformed segment becomes the Next notFound signal (the friendly
  // 404), and the database never sees it.
  //
  // This route used to skip the guard, so a mistyped id reached the
  // query and surfaced as a database error instead. It was the one
  // tenant route without the check.
  requireUuidParam(tenantId);
  const { role, key } = await searchParams;
  const view = await getEffectiveConfiguration(asTenantId(tenantId));
  if (!view) notFound();

  const changeRequests = await listConfigChangeRequests(view.tenant.id);
  const allTenants = await listAllTenantsForSelector();

  const selectedRoleKey =
    role && view.roles.some((r) => r.key === role) ? role : view.roles[0]?.key;
  const selectedRole = view.roles.find((r) => r.key === selectedRoleKey);
  const navItems = selectedRole ? navForRole(selectedRole.key) : [];
  const featureKeys = new Set(view.tenant.featureKeys.map((f) => f.key));

  // PR5 — "why this value" + the scoped audit log, only when a real
  // key is selected (the ?key= query param, set by the "Why this
  // value?" link on each row below).
  const selectedConfigKey =
    key && view.config.some((c) => c.key === key) ? (key as ConfigKeyName) : null;
  const resolutionChain = selectedConfigKey
    ? await resolveConfigChain(view.tenant.id, selectedConfigKey)
    : null;
  const configAuditLog = selectedConfigKey
    ? await getTenantConfigAuditLog(view.tenant.id, selectedConfigKey)
    : null;

  // Keys whose location resolution differs from the tenant resolution —
  // the only location rows worth showing.
  const locationRows = view.locationConfig.flatMap((location) =>
    location.values
      .filter((value) => {
        const tenantValue = view.config.find((c) => c.key === value.key);
        return (
          tenantValue !== undefined &&
          (value.source.scopeType !== tenantValue.source.scopeType ||
            JSON.stringify(value.value) !== JSON.stringify(tenantValue.value))
        );
      })
      .map((value) => ({ location, value })),
  );

  return (
    <OpsPage>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-[14px] text-ink-2">
          Every value this tenant resolves, where it came from, and what each
          role can reach. The resolved values are read-only and no member data
          appears on this page; the change requests further down are decided
          separately.{" "}
          <Link
            href={`/ops/tenants/${view.tenant.id}/tax`}
            className="text-[var(--accent-ink)] underline underline-offset-2"
          >
            GST rates live on their own page
          </Link>
          .
        </p>
        <TenantSelector
          tenants={allTenants}
          selectedTenantId={view.tenant.id}
          {...(selectedRoleKey ? { role: selectedRoleKey } : {})}
          {...(selectedConfigKey ? { configKey: selectedConfigKey } : {})}
        />
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={view.tenant.status} />
        <Stat label="Plan" value={view.tenant.planName ?? "—"} />
        <Stat label="Timezone" value={view.tenant.timezone} />
        <Stat label="Locations" value={String(view.tenant.locations.length)} />
      </section>

      <OpsSection className="mt-8" title="Configuration values">
        <ResolvedValues
          configs={view.config}
          selectedConfigKey={selectedConfigKey}
          chainHref={(key) => chainHref(key, selectedRoleKey)}
        >
          {(key) =>
            resolutionChain && configAuditLog ? (
              <ResolutionChain
                configKey={key}
                chain={resolutionChain}
                auditLog={configAuditLog}
              />
            ) : null
          }
        </ResolvedValues>
      </OpsSection>

      <OpsSection className="mt-8" title="Location overrides">
        <LocationOverrides rows={locationRows} />
      </OpsSection>

      <OpsSection className="mt-8" title="Change requests">
        <ChangeRequests
          canWrite={canWrite}
          requests={changeRequests.map((request) => ({
            id: request.id,
            key: request.key,
            requestedValue: request.requestedValue,
            note: request.note,
            status: request.status as "requested" | "resolved" | "declined",
            resolutionNote: request.resolutionNote,
            createdAt: request.createdAt.toISOString(),
          }))}
        />
      </OpsSection>

      <OpsSection className="mt-8" title="Entitlements">
        {view.tenant.featureKeys.length === 0 ? (
          <OpsEmptyState
            title="No features are entitled"
            body="This plan grants no feature, and no per-tenant override turns one on."
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {view.tenant.featureKeys.map((feature) => (
              <span
                key={feature.key}
                className="rounded-ctl bg-deck px-3 py-1.5 text-[12px]"
              >
                <span className="font-mono text-ink">{feature.key}</span>
                <span className="ml-2 text-ink-3">
                  {feature.source}
                  {feature.expiresAt
                    ? ` · expires ${DATETIME_FMT.format(new Date(feature.expiresAt))}`
                    : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </OpsSection>

      <OpsSection className="mt-8" title="Permission matrix">
        <PermissionMatrix roles={view.roles} />
      </OpsSection>

      <OpsSection className="mt-8" title="Nav preview">
        <NavPreview
          roles={view.roles}
          selectedRoleKey={selectedRoleKey}
          navItems={navItems}
          entitledFeatureKeys={featureKeys}
        />
      </OpsSection>
    </OpsPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-paper px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-medium text-ink">{value}</div>
    </div>
  );
}
