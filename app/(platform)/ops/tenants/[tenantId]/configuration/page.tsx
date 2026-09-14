import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getEffectiveConfiguration } from "@/db/ops-configuration-view";
import { listConfigChangeRequests } from "@/db/config-requests";
import type { ResolvedConfig } from "@/db/config";
import { navForRole } from "@/lib/nav";
import { asTenantId } from "@/lib/ids";
import { ChangeRequests } from "./change-requests";

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
  searchParams: Promise<{ role?: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  const { role } = await searchParams;
  const view = await getEffectiveConfiguration(asTenantId(tenantId));
  if (!view) notFound();

  const changeRequests = await listConfigChangeRequests(view.tenant.id);

  const selectedRoleKey =
    role && view.roles.some((r) => r.key === role) ? role : view.roles[0]?.key;
  const selectedRole = view.roles.find((r) => r.key === selectedRoleKey);
  const navItems = selectedRole ? navForRole(selectedRole.key) : [];
  const featureKeys = new Set(view.tenant.featureKeys.map((f) => f.key));

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
    <div className="max-w-4xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/ops/tenants"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Tenants
        </Link>
        {" / "}
        <Link
          href={`/ops/tenants/${view.tenant.id}`}
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          {view.tenant.name}
        </Link>
        {" / "}
        configuration
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        Effective configuration
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Every value this tenant resolves, where it came from, and what
        each role can reach. Read-only — no member data on this page.
      </p>

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
                <SourcePill config={config} />
              </div>
              <p className="mt-1 text-[14px] text-ink font-medium">
                {renderValue(config.value)}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {config.description} · {config.visibility} · {config.risk} risk
              </p>
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
