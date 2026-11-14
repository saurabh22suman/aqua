import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  StatusBadge,
  TENANT_STATUS_TONE,
  type StatusTone,
} from "@/components/ui/StatusBadge";
import type { TenantHealthStatus } from "@/db/tenant-health";
import {
  OpsTable,
  OpsTableCell,
  OpsTableGrid,
  OpsTableHead,
} from "@/components/ops/ops-table";

// Ops redesign (28 October 2026) — the tenants table.
//
// The table is dense and keeps its own sideways scroll inside a
// LABELLED region, so a column set that cannot fit scrolls inside the
// table instead of squeezing names into four-line wraps — and the page
// itself never scrolls sideways.
//
// The phone keeps a card list (F2); this table is the md+ view.

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  memberCount: number;
  locationCount: number;
  planName: string | null;
  createdAt: Date;
  trialExpiresAt: Date | null;
  health: TenantHealthStatus | null;
};

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  churned: "Churned",
};

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

// The zone is NAMED: the deployed container runs in UTC, and an
// inherited zone put a created date on the wrong day.
const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export function StatusPill({ status }: { status: string }) {
  return (
    <StatusBadge tone={TENANT_STATUS_TONE[status] ?? "neutral"}>
      {STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

export function HealthPill({ health }: { health: TenantHealthStatus | null | undefined }) {
  if (!health) return <span className="text-ink-3">—</span>;
  return <StatusBadge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</StatusBadge>;
}

// Renewal date isn't wired up yet (that's a subscriptions join, not
// part of this PR's admitted signals) — a trial tenant with no
// trial_expires_at set shows "Trial" rather than a fabricated date.
export function TrialRenewalCell({
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

/** The phone card list — the same records, readable on a narrow screen. */
export function TenantCards({ rows }: { rows: readonly TenantRow[] }) {
  return (
    <ul className="mt-6 space-y-3 md:hidden" data-testid="ops-tenants-cards">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/ops/tenants/${row.id}`}
            className="block rounded-card border border-line bg-paper p-4 active:bg-deck"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{row.name}</p>
                <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3">
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
  );
}

/** The desktop table. */
export function TenantTable({ rows }: { rows: readonly TenantRow[] }) {
  return (
    <div className="mt-6 hidden md:block" data-testid="ops-tenants-table">
      <OpsTable label="Tenants">
        <OpsTableGrid>
          <thead>
            <tr>
              <OpsTableHead>Tenant</OpsTableHead>
              <OpsTableHead>Status</OpsTableHead>
              <OpsTableHead numeric>Members</OpsTableHead>
              <OpsTableHead numeric>Locations</OpsTableHead>
              <OpsTableHead>Plan</OpsTableHead>
              <OpsTableHead>Created</OpsTableHead>
              <OpsTableHead>Health</OpsTableHead>
              <OpsTableHead>Trial / Renewal</OpsTableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="transition-colors duration-150 hover:bg-deck/40"
              >
                <OpsTableCell>
                  <Link
                    href={`/ops/tenants/${row.id}`}
                    className="font-medium text-ink hover:underline underline-offset-2"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-3">{row.slug}</p>
                </OpsTableCell>
                <OpsTableCell>
                  <StatusPill status={row.status} />
                </OpsTableCell>
                <OpsTableCell numeric>{row.memberCount}</OpsTableCell>
                <OpsTableCell numeric>{row.locationCount}</OpsTableCell>
                <OpsTableCell>{row.planName ?? "—"}</OpsTableCell>
                <OpsTableCell>{DATE_FMT.format(row.createdAt)}</OpsTableCell>
                <OpsTableCell>
                  <HealthPill health={row.health} />
                </OpsTableCell>
                <OpsTableCell>
                  <TrialRenewalCell status={row.status} trialExpiresAt={row.trialExpiresAt} />
                </OpsTableCell>
              </tr>
            ))}
          </tbody>
        </OpsTableGrid>
      </OpsTable>
    </div>
  );
}
