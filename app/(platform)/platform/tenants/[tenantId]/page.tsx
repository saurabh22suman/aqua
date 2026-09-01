import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";

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
            <p className="text-[14px] text-ink-2">No locations yet.</p>
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
            <p className="text-[14px] text-ink-2">
              No features enabled on this plan.
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
            <p className="text-[14px] text-ink-2">
              No activity yet.
            </p>
            <p className="mt-2 text-[12px] text-ink-3">
              Status changes, suspensions and impersonation events will
              appear here.
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
