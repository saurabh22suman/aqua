import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { StatusTransitionControls } from "./status-transitions";

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  churned: "Churned",
};

function StatusPill({ status }: { status: string }) {
  if (status === "suspended") {
    return (
      <span className="text-[12px] font-medium px-3 py-1 rounded-pill bg-late-soft text-late">
        {STATUS_LABEL[status]}
      </span>
    );
  }
  if (status === "trial") {
    return (
      <span className="text-[12px] font-medium px-3 py-1 rounded-pill bg-warn-soft text-warn">
        {STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span className="text-[12px] font-medium px-3 py-1 rounded-pill bg-deck text-ink-2">
      {STATUS_LABEL[status]}
    </span>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/platform/login");

  const { tenantId } = await params;
  const detail = await getTenantDetail(asTenantId(tenantId));
  if (!detail) notFound();

  return (
    <div className="max-w-5xl">
      <Link
        href="/platform/tenants"
        className="text-[13px] text-ink-3 hover:text-ink underline-offset-2 hover:underline"
      >
        ← All tenants
      </Link>

      <div className="mt-3 flex items-baseline gap-4">
        <h1 className="font-display text-[28px] font-semibold text-marine">
          {detail.name}
        </h1>
        <StatusPill status={detail.status} />
      </div>
      <p className="mt-1 font-mono text-[13px] text-ink-3">{detail.slug}</p>

      <section className="mt-6">
        <SectionHeader
          title="Status"
          subtitle="Suspends and reactivations take effect immediately and write to the audit log."
        />
        <div className="rounded-card bg-paper border border-line px-4 py-3">
          <StatusTransitionControls
            tenantId={detail.id}
            currentStatus={detail.status}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="Settings" />
        <div className="rounded-card bg-paper border border-line overflow-hidden">
          <DescriptionRow label="Timezone" value={detail.timezone} />
          <DescriptionRow label="Currency" value={detail.currency} />
          <DescriptionRow label="GSTIN" value={detail.gstin ?? "—"} mono />
          <DescriptionRow
            label="Plan"
            value={detail.planName ?? "—"}
            href={detail.planId ? `/platform/plans/${detail.planId}` : undefined}
          />
          <DescriptionRow
            label="Preset"
            value={
              detail.presetKey
                ? `${detail.presetKey} v${detail.presetVersion ?? "?"}`
                : "—"
            }
          />
          <DescriptionRow
            label="Offline sync (per-tenant)"
            value={detail.offlineSyncEnabled ? "Enabled" : "Disabled (default)"}
          />
          <DescriptionRow
            label="Created"
            value={`${DATE_FMT.format(detail.createdAt)} · updated ${DATETIME_FMT.format(detail.updatedAt)}`}
          />
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Members" value={detail.memberCount} />
        <StatCard label="Locations" value={detail.locationCount} />
        <StatCard label="Sessions this month" value={detail.sessionsThisMonth} />
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Locations"
          subtitle={`${detail.locations.length} live · soft-deleted hidden`}
        />
        {detail.locations.length === 0 ? (
          <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
            <p className="text-[14px] font-medium text-ink">
              No locations yet
            </p>
            <p className="mt-2 text-[13px] text-ink-3">
              New tenants ship with one location from the create-tenant
              form. Adding more is part of the onboarding wizard.
            </p>
          </div>
        ) : (
          <div className="rounded-card bg-paper border border-line overflow-hidden">
            <ul>
              {detail.locations.map((loc) => (
                <li
                  key={loc.id}
                  className="flex items-center justify-between px-4 py-3 border-b border-line last:border-b-0"
                >
                  <div>
                    <p className="text-[14px] font-medium text-ink">
                      {loc.name}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      Added {DATE_FMT.format(loc.createdAt)}
                    </p>
                  </div>
                  {loc.isPrimary ? (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-pill bg-water-soft text-water">
                      Primary
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Feature state"
          subtitle="Resolved from the plan; per-tenant overrides land in 1.8"
        />
        {detail.featureKeys.length === 0 ? (
          <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
            <p className="text-[14px] font-medium text-ink">
              No features on this plan
            </p>
            <p className="mt-2 text-[13px] text-ink-3">
              The tenant&apos;s plan has no GA features attached. The
              catalogue is editable; per-tenant overrides land in 1.8.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.featureKeys.map((key) => (
              <span
                key={key}
                className="text-[12px] font-medium px-3 py-1 rounded-pill bg-water-soft text-water"
              >
                {key}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Recent activity"
          subtitle="Last 20 platform events scoped to this tenant"
        />
        {detail.recentActivity.length === 0 ? (
          <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
            <p className="text-[14px] font-medium text-ink">
              No activity yet
            </p>
            <p className="mt-2 text-[13px] text-ink-3">
              Status changes, suspensions, churns, and feature edits
              write to the audit log and surface here once they happen.
            </p>
          </div>
        ) : (
          <ul className="rounded-card bg-paper border border-line overflow-hidden">
            {detail.recentActivity.map((event) => (
              <li
                key={event.id}
                className="px-4 py-3 border-b border-line last:border-b-0"
              >
                <p className="text-[14px] text-ink font-mono">{event.action}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {DATETIME_FMT.format(event.createdAt)}
                </p>
                <ActivityDetail detail={event.detail} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>
      ) : null}
    </div>
  );
}

function DescriptionRow({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  return (
    <div className="grid grid-cols-3 px-4 py-3 border-b border-line last:border-b-0">
      <p className="text-[13px] text-ink-3">{label}</p>
      <div className="col-span-2">
        {href ? (
          <Link
            href={href}
            className={`text-[14px] text-ink hover:underline underline-offset-2 ${mono ? "font-mono" : ""}`}
          >
            {value}
          </Link>
        ) : (
          <p
            className={`text-[14px] text-ink ${mono ? "font-mono" : ""}`}
          >
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-paper border border-line px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.10em] text-ink-3">
        {label}
      </p>
      <p className="mt-2 font-display text-[28px] font-semibold text-marine tabular-nums">
        {value}
      </p>
    </div>
  );
}

// Renders the structured detail JSON written by the platform-side
// service actions. The audit row carries enough to answer "why did
// this happen" without re-opening the row — show the reason if there
// is one, then any before/after diff. Falls back to the raw JSON for
// unknown action shapes so the timeline never silently drops detail.
function ActivityDetail({ detail }: { detail: Record<string, unknown> }) {
  if (!detail || Object.keys(detail).length === 0) return null;

  const reason =
    typeof detail.reason === "string" && detail.reason.length > 0
      ? detail.reason
      : null;

  const fromTo =
    typeof detail.from === "string" && typeof detail.to === "string"
      ? `${detail.from} → ${detail.to}`
      : null;

  const before =
    detail.before && typeof detail.before === "object"
      ? (detail.before as Record<string, unknown>)
      : null;
  const after =
    detail.after && typeof detail.after === "object"
      ? (detail.after as Record<string, unknown>)
      : null;

  return (
    <div className="mt-1.5 text-[12px] text-ink-2 space-y-1">
      {reason ? (
        <p>
          <span className="text-ink-3">Reason:</span> {reason}
        </p>
      ) : null}
      {fromTo ? (
        <p>
          <span className="text-ink-3">Status:</span> {fromTo}
        </p>
      ) : null}
      {before && after ? (
        <p className="font-mono text-[11px] text-ink-3 break-all">
          {Object.keys(after)
            .map((k) => {
              const b = before[k];
              const a = after[k];
              return `${k}: ${String(b)} → ${String(a)}`;
            })
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
