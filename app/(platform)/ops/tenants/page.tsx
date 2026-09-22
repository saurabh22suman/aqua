import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listTenants, listAllPlansForFilter } from "@/db/platform-tenants";
import { listPresets } from "@/db/platform-presets";
import {
  StatusBadge,
  TENANT_STATUS_TONE,
  type StatusTone,
} from "@/components/ui/StatusBadge";
import type { TenantHealthStatus } from "@/db/tenant-health";

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  churned: "Churned",
};

// Status pills were neutral for all four states until the 2026-09-13
// UI/UX audit (§7.1) — Active and Churned computed to identical
// colours, which made the list unskimmable. The shared StatusBadge
// now carries the Members-list semantics: active=good, trial=warn,
// suspended=late, churned=neutral. Every pill still carries its
// word, so colour is never the only carrier (DESIGN.md §3).
function StatusPill({ status }: { status: string }) {
  return (
    <StatusBadge tone={TENANT_STATUS_TONE[status] ?? "neutral"}>
      {STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// PR2 (ops tenant health) — db/tenant-health.ts computes the status;
// this is only the display mapping. `null` (churned tenants — not
// scored) renders as a dash, not a pill, per the same "don't imply
// there's a value when there isn't one" rule the rest of this page
// already follows for planName.
const HEALTH_LABEL: Record<TenantHealthStatus, string> = {
  healthy: "Healthy",
  attention: "Attention",
  at_risk: "At risk",
};
const HEALTH_TONE: Record<TenantHealthStatus, StatusTone> = {
  healthy: "good",
  attention: "warn",
  at_risk: "late",
};

function HealthPill({ health }: { health: TenantHealthStatus | null | undefined }) {
  if (!health) return <span className="text-ink-3">—</span>;
  return <StatusBadge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</StatusBadge>;
}

// Renewal date isn't wired up yet (that's a subscriptions join, not
// part of this PR's admitted signals) — a trial tenant with no
// trial_expires_at set shows "Trial" rather than a fabricated date.
function TrialRenewalCell({
  status,
  trialExpiresAt,
}: {
  status: string;
  trialExpiresAt: Date | null | undefined;
}) {
  if (status !== "trial") return <span className="text-ink-3">—</span>;
  if (!trialExpiresAt) return <span className="text-ink-2">Trial</span>;
  return <span className="text-ink-2">Trial ends {DATE_FMT.format(trialExpiresAt)}</span>;
}

type SearchParams = {
  search?: string;
  status?: string;
  planId?: string;
  presetKey?: string;
  health?: string;
  trial?: string;
  page?: string;
};

const HEALTH_FILTER_VALUES = ["healthy", "attention", "at_risk"] as const;
const TRIAL_FILTER_VALUES = ["expiring_soon", "expired"] as const;

// Preserves every current filter while changing just `page` — so
// paging never silently drops the filters the operator set.
function pageHref(params: SearchParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.planId) qs.set("planId", params.planId);
  if (params.presetKey) qs.set("presetKey", params.presetKey);
  if (params.health) qs.set("health", params.health);
  if (params.trial) qs.set("trial", params.trial);
  if (page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/ops/tenants?${query}` : "/ops/tenants";
}

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const health = HEALTH_FILTER_VALUES.find((v) => v === params.health);
  const trial = TRIAL_FILTER_VALUES.find((v) => v === params.trial);

  const [result, plans, presetEntries] = await Promise.all([
    listTenants({
      search: params.search?.trim() || undefined,
      status:
        params.status === "trial" ||
        params.status === "active" ||
        params.status === "suspended" ||
        params.status === "churned"
          ? params.status
          : undefined,
      planId: params.planId || undefined,
      presetKey: params.presetKey || undefined,
      health,
      trial,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listAllPlansForFilter(),
    listPresets(),
  ]);

  // One row per preset key for the filter dropdown — listPresets()
  // returns one row per (key, version).
  const presets = Array.from(
    new Map(presetEntries.map((p) => [p.key, p])).values(),
  );

  const hasFilters =
    Boolean(params.search) ||
    Boolean(params.status) ||
    Boolean(params.planId) ||
    Boolean(params.presetKey) ||
    Boolean(health) ||
    Boolean(trial);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const rangeStart = result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, result.total);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Tenants
          </p>
          <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
            All tenants
          </h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {result.total === 0
              ? "0 tenants"
              : `Showing ${rangeStart}–${rangeEnd} of ${result.total} ${result.total === 1 ? "tenant" : "tenants"}`}
            {hasFilters ? " matching the current filter" : ""}
          </p>
        </div>
        <Link
          href="/ops/tenants/new"
          className="rounded-pill py-2.5 px-5 text-[14px] font-semibold text-white bg-[var(--accent-strong)] transition-colors duration-150"
        >
          New tenant
        </Link>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <label className="flex-1 block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Search
          </span>
          <input
            type="search"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="name or slug"
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink placeholder:text-ink-3 focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Status
          </span>
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Plan
          </span>
          <select
            name="planId"
            defaultValue={params.planId ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Preset
          </span>
          <select
            name="presetKey"
            defaultValue={params.presetKey ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Health
          </span>
          <select
            name="health"
            defaultValue={params.health ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All</option>
            <option value="healthy">Healthy</option>
            <option value="attention">Attention</option>
            <option value="at_risk">At risk</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Trial
          </span>
          <select
            name="trial"
            defaultValue={params.trial ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-marine hover:opacity-90 transition-colors duration-150"
        >
          Apply
        </button>
        {hasFilters ? (
          <Link
            href="/ops/tenants"
            className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {result.rows.length === 0 ? (
        <div className="mt-10 text-center py-12 rounded-card bg-paper border border-line">
          <p className="text-[15px] font-medium text-ink">
            {hasFilters ? "No tenants match these filters." : "No tenants yet."}
          </p>
          <p className="mt-2 text-[13px] text-ink-3">
            {hasFilters
              ? "Try clearing the filter, or "
              : "Create the first tenant from the control plane. "}
            <Link
              href="/ops/tenants/new"
              className="text-[var(--accent-ink)] underline underline-offset-2"
            >
              add a tenant
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {/* F2 (mobile UX plan v2): phones get cards; the six-column
              table is kept for md+ and no longer clips columns behind
              overflow-hidden on small screens. */}
          <ul className="mt-6 space-y-3 md:hidden" data-testid="ops-tenants-cards">
            {result.rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/ops/tenants/${row.id}`}
                  className="block rounded-card bg-paper border border-line p-4 active:bg-deck"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{row.name}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3 font-mono truncate">
                        {row.slug}
                      </p>
                    </div>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-ink-2 tabular-nums">
                    <span>Members: {row.memberCount}</span>
                    <span>Locations: {row.locationCount}</span>
                    <ChevronRight size={16} className="text-ink-3" aria-hidden="true" />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                    <HealthPill health={row.health} />
                    <TrialRenewalCell status={row.status} trialExpiresAt={row.trialExpiresAt} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div
            className="mt-6 hidden md:block rounded-card bg-paper border border-line overflow-x-auto"
            data-testid="ops-tenants-table"
          >
            <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.10em] text-ink-3 border-b border-line">
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Members</th>
                <th className="px-4 py-3 font-medium text-right">Locations</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Trial / Renewal</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-b-0 hover:bg-deck/40 transition-colors duration-150"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/ops/tenants/${row.id}`}
                      className="font-medium text-ink hover:underline underline-offset-2"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 text-[12px] text-ink-3 font-mono">
                      {row.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.memberCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.locationCount}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{row.planName ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-2">
                    {DATE_FMT.format(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <HealthPill health={row.health} />
                  </td>
                  <td className="px-4 py-3">
                    <TrialRenewalCell status={row.status} trialExpiresAt={row.trialExpiresAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[12px] text-ink-3">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(params, page - 1)}
                    className="rounded-pill border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink flex items-center gap-1"
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Previous
                  </Link>
                ) : (
                  <span className="rounded-pill border border-line px-3 py-1.5 text-[12px] font-medium text-ink-3/50 flex items-center gap-1">
                    <ChevronLeft size={14} aria-hidden="true" /> Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={pageHref(params, page + 1)}
                    className="rounded-pill border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink flex items-center gap-1"
                  >
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="rounded-pill border border-line px-3 py-1.5 text-[12px] font-medium text-ink-3/50 flex items-center gap-1">
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
