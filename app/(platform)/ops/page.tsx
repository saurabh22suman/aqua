import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ClipboardList,
  MessageCircle,
  SlidersHorizontal,
} from "lucide-react";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  getPlatformMetricsSummary,
  getNeedsAttentionQueue,
  type MetricDelta,
} from "@/db/platform-overview";
import { listPlatformActivity } from "@/db/platform-activity";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

// PR3 (ops console improvements) — Overview becomes a dashboard.
//
// Layout decision: the needs-attention queue is the primary element,
// not the KPI strip. The KPIs are glanceable context ("is the
// platform generally okay"); the queue is what an operator actually
// acts on, the same "what needs me right now" pattern already proven
// on the owner dashboard. It gets the dominant width; quick actions
// and recent activity share a narrower secondary column.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function DeltaLine({ label, delta }: { label: string; delta: MetricDelta }) {
  if (delta.previous == null) {
    return (
      <p className="mt-1 text-[12px] text-ink-3">{label} — no comparison yet</p>
    );
  }
  const diff = delta.current - delta.previous;
  if (diff === 0) {
    return <p className="mt-1 text-[12px] text-ink-3">No change from last month</p>;
  }
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-3">
      <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
      {diff > 0 ? "+" : ""}
      {diff} from last month
    </p>
  );
}

function KpiCard({
  label,
  delta,
}: {
  label: string;
  delta: MetricDelta;
}) {
  return (
    <div className="rounded-card bg-paper border border-line p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold text-marine tabular-nums">
        {delta.current}
      </p>
      <DeltaLine label={label} delta={delta} />
    </div>
  );
}

const SEVERITY_TONE: Record<"attention" | "at_risk", StatusTone> = {
  attention: "warn",
  at_risk: "late",
};
const SEVERITY_LABEL: Record<"attention" | "at_risk", string> = {
  attention: "Medium",
  at_risk: "High",
};

export default async function PlatformHome() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/ops/login");
  }
  if (status.kind === "unauthenticated") redirect("/ops/verify");

  const [metrics, queue, activity] = await Promise.all([
    getPlatformMetricsSummary(),
    getNeedsAttentionQueue(11),
    listPlatformActivity({ limit: 5 }),
  ]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Overview
          </p>
          <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
            Aqua control plane
          </h1>
          <p className="mt-2 text-[15px] text-ink-2">
            Signed in as <span className="font-medium">{status.role}</span>.
          </p>
        </div>
        {metrics.asOf ? (
          <p className="text-[12px] text-ink-3 whitespace-nowrap">
            Last refreshed {DATE_FMT.format(metrics.asOf)} IST
          </p>
        ) : null}
      </div>

      {!metrics.asOf ? (
        <p className="mt-6 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
          No metrics snapshot yet — the platform.metrics-snapshot job runs
          nightly. Counts below are unavailable until it runs once.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Active tenants" delta={metrics.activeTenants} />
          <KpiCard label="On trial" delta={metrics.trialTenants} />
          <KpiCard label="At risk" delta={metrics.atRiskTenants} />
          <KpiCard label="Open ops tasks" delta={metrics.openOpsTasks} />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-[18px] font-semibold text-marine">
              Needs attention
            </h2>
            <span className="text-[12px] text-ink-3">
              {queue.length} {queue.length === 1 ? "item" : "items"}
            </span>
          </div>
          {queue.length === 0 ? (
            <div className="mt-3 rounded-card bg-paper border border-line px-5 py-10 text-center">
              <p className="text-[14px] font-medium text-ink">Nothing needs attention</p>
              <p className="mt-1 text-[12px] text-ink-3">
                Every tenant is healthy, or the metrics snapshot hasn&apos;t run yet.
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-card bg-paper border border-line overflow-hidden">
              {queue.map((item, i) => (
                <div
                  key={`${item.tenantId}-${item.text}-${i}`}
                  className="border-b border-line last:border-b-0 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">
                      {item.tenantName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-2">{item.text}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[12px] text-ink-3 tabular-nums">
                      {item.ageDays != null ? `${item.ageDays}d` : "—"}
                    </span>
                    <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                      {SEVERITY_LABEL[item.severity]}
                    </StatusBadge>
                    <Link
                      href={`/ops/tenants/${item.tenantId}`}
                      className="text-[12px] font-medium text-[var(--accent)] hover:underline underline-offset-2"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <h2 className="font-display text-[18px] font-semibold text-marine">
              Quick actions
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <Link
                href="/ops/tenants"
                className="rounded-card bg-paper border border-line p-3 hover:border-[var(--accent)] transition-colors duration-150"
              >
                <p className="text-[13px] font-medium text-ink">Tenants</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  List every tenant, drill into settings, suspend or churn.
                </p>
              </Link>
              <Link
                href="/ops/features"
                className="rounded-card bg-paper border border-line p-3 hover:border-[var(--accent)] transition-colors duration-150"
              >
                <p className="text-[13px] font-medium text-ink">Feature catalogue</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Editable list of every feature Aqua ships.
                </p>
              </Link>
              <Link
                href="/ops/presets"
                className="rounded-card bg-paper border border-line p-3 hover:border-[var(--accent)] transition-colors duration-150"
              >
                <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                  <SlidersHorizontal size={13} strokeWidth={2} /> Presets
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Apply a feature and vocabulary preset to a tenant.
                </p>
              </Link>
              <Link
                href="/ops/leads"
                className="rounded-card bg-paper border border-line p-3 hover:border-[var(--accent)] transition-colors duration-150"
              >
                <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                  <ClipboardList size={13} strokeWidth={2} /> Leads
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Sales pipeline: qualification answers become the tenant&apos;s preset and configuration.
                </p>
              </Link>
              {mockMessagingEnabled() ? (
                <Link
                  href="/ops/whatsapp"
                  className="rounded-card bg-paper border border-line p-3 hover:border-[var(--accent)] transition-colors duration-150"
                >
                  <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <MessageCircle size={13} strokeWidth={2} /> WhatsApp mock
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Non-production: send and receive mock messages through the real pipeline.
                  </p>
                </Link>
              ) : null}
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[18px] font-semibold text-marine">
                Recent activity
              </h2>
              <Link
                href="/ops/activity"
                className="text-[12px] font-medium text-[var(--accent)] hover:underline underline-offset-2 flex items-center gap-1"
              >
                <Activity size={12} strokeWidth={2} /> View all
              </Link>
            </div>
            {activity.rows.length === 0 ? (
              <p className="mt-3 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
                No platform activity yet.
              </p>
            ) : (
              <div className="mt-3 rounded-card bg-paper border border-line overflow-hidden">
                {activity.rows.map((row) => (
                  <div key={row.id} className="border-b border-line last:border-b-0 px-4 py-3">
                    <p className="text-[12px] text-ink">
                      {row.action}
                      {row.tenantName ? (
                        <span className="text-ink-3"> · {row.tenantName}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {DATE_FMT.format(row.createdAt)} IST
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
