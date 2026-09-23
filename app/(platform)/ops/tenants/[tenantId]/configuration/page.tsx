import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getEffectiveConfiguration } from "@/db/ops-configuration-view";
import { listConfigChangeRequests } from "@/db/config-requests";
import { resolveConfigChain, type ResolvedConfig } from "@/db/config";
import { getTenantConfigAuditLog } from "@/db/tenant-config-audit";
import { listAllTenantsForSelector } from "@/db/platform-tenants";
import { navForRole } from "@/lib/nav";
import { asTenantId } from "@/lib/ids";
import type { ConfigKeyName } from "@/db/config-definitions";
import { ChangeRequests } from "./change-requests";
import { TenantSelector } from "./tenant-selector";
import { ResolutionChain } from "./resolution-chain";

// O-06 (docs/ops-platform-design.md §6) — the effective-configuration
// viewer. Answers "why can't my coach see Reports?" from resolved
// values, entitlements and the permission matrix. No member PII is
// queried by the data layer (db/ops-configuration-view.ts); the test
// suite pins both the source scan and the rendered output.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function renderValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderSource(config: ResolvedConfig): string {
  if (config.source.scopeType === "default") return "platform default";
  const scopeId = config.source.scopeId
    ? `: ${config.source.scopeId}`
    : "";
  const by = config.source.setBy ? ` · set by ${config.source.setBy.slice(0, 8)}` : "";
  const at = config.source.setAt
    ? ` · ${DATETIME_FMT.format(new Date(config.source.setAt))} IST`
    : "";
  return `${config.source.scopeType}${scopeId}${by}${at}`;
}

// PR5 — the current URL, with ?key set to this row (and ?role kept as
// is, if a non-default role is selected) — the "Why this value?" link.
function chainHref(key: string, role: string | undefined): string {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  params.set("key", key);
  return `?${params.toString()}`;
}

function SourcePill({ config }: { config: ResolvedConfig }) {
  const isDefault = config.source.scopeType === "default";
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
        isDefault ? "bg-deck text-ink-3" : "bg-marine/10 text-marine"
      }`}
    >
      {renderSource(config)}
    </span>
  );
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

  const { tenantId } = await params;
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
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-[14px] text-ink-2 max-w-2xl">
          Every value this tenant resolves, where it came from, and what
          each role can reach. Read-only — no member data on this page.{" "}
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

      <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Status" value={view.tenant.status} />
        <Stat label="Plan" value={view.tenant.planName ?? "—"} />
        <Stat label="Timezone" value={view.tenant.timezone} />
        <Stat label="Locations" value={String(view.tenant.locations.length)} />
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Configuration values
        </h2>
        <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
          {view.config.map((config) => (
            <div
              key={config.key}
              className="border-b border-line last:border-b-0 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[13px] text-ink">{config.key}</span>
                <div className="flex items-center gap-2">
                  <SourcePill config={config} />
                  <Link
                    href={chainHref(config.key, selectedRoleKey)}
                    className={`text-[11px] font-medium underline underline-offset-2 ${
                      selectedConfigKey === config.key
                        ? "text-marine"
                        : "text-[var(--accent-ink)]"
                    }`}
                  >
                    Why this value?
                  </Link>
                </div>
              </div>
              <p className="mt-1 text-[14px] text-ink font-medium">
                {renderValue(config.value)}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {config.description} · {config.visibility} · {config.risk} risk
              </p>
              {selectedConfigKey === config.key && resolutionChain && configAuditLog ? (
                <div className="mt-3">
                  <ResolutionChain
                    configKey={config.key}
                    chain={resolutionChain}
                    auditLog={configAuditLog}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Location overrides
        </h2>
        {locationRows.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            No location-scoped overrides. Every location resolves the same
            values as the tenant.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {locationRows.map(({ location, value }) => (
              <div
                key={`${location.locationId}-${value.key}`}
                className="border-b border-line last:border-b-0 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-ink">
                    <span className="font-medium">{location.locationName}</span>
                    {location.isPrimary ? " (primary)" : ""} ·{" "}
                    <span className="font-mono">{value.key}</span>
                  </span>
                  <SourcePill config={value} />
                </div>
                <p className="mt-1 text-[14px] text-ink font-medium">
                  {renderValue(value.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Change requests
        </h2>
        <ChangeRequests
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
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Entitlements
        </h2>
        {view.tenant.featureKeys.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            No features are entitled on this plan or by override.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {view.tenant.featureKeys.map((feature) => (
              <li
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Permission matrix
        </h2>
        <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
          {view.roles.map((roleRow) => (
            <details
              key={roleRow.key}
              className="border-b border-line last:border-b-0 px-4 py-3"
            >
              <summary className="cursor-pointer text-[13px] text-ink">
                <span className="font-medium">{roleRow.name}</span>{" "}
                <span className="text-ink-3">
                  ({roleRow.key}) · home {roleRow.homePath} ·{" "}
                  {roleRow.permissions.length} permission
                  {roleRow.permissions.length === 1 ? "" : "s"}
                </span>
              </summary>
              {roleRow.permissions.length === 0 ? (
                <p className="mt-2 text-[12px] text-ink-3">
                  No permissions granted.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {roleRow.permissions.map((permission) => (
                    <li
                      key={permission}
                      className="rounded-ctl bg-deck px-2 py-0.5 font-mono text-[11px] text-ink-2"
                    >
                      {permission}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Nav preview
        </h2>
        <form method="get" className="mt-2 flex items-center gap-3">
          <label className="text-[12px] text-ink-2" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={selectedRoleKey}
            className="rounded-ctl border border-line bg-paper px-3 py-1.5 text-[13px] text-ink"
          >
            {view.roles.map((roleRow) => (
              <option key={roleRow.key} value={roleRow.key}>
                {roleRow.name} ({roleRow.key})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-pill border border-line px-4 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            Preview
          </button>
        </form>
        {navItems.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            This role renders no tenant nav (no surface).
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {navItems.map((item) => {
              const gatedOut =
                item.featureKey !== undefined && !featureKeys.has(item.featureKey);
              return (
                <li
                  key={item.href}
                  className={`rounded-ctl px-3 py-1.5 text-[12px] ${
                    gatedOut ? "bg-paper border border-line text-ink-3 line-through" : "bg-deck text-ink"
                  }`}
                >
                  {item.label}
                  <span className="ml-2 font-mono text-[11px] text-ink-3">
                    {item.href}
                  </span>
                  {gatedOut ? (
                    <span className="ml-2 text-[11px] text-ink-3">
                      hidden — feature off
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-paper border border-line px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-medium text-ink">{value}</div>
    </div>
  );
}
