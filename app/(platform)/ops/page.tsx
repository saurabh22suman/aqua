import Link from "next/link";
import { redirect } from "next/navigation";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  getPlatformMetricsSummary,
  getNeedsAttentionQueue,
} from "@/db/platform-overview";
import { listPlatformActivity } from "@/db/platform-activity";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import {
  OpsCardFlush,
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
  OpsPanel,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OpsOverviewMetrics } from "./ops-overview-metrics";

// PR3 (ops console improvements) — Overview becomes a dashboard.
//
// Layout decision: the needs-attention queue is the primary element,
// not the KPI strip. The KPIs are glanceable context ("is the
// platform generally okay"); the queue is what an operator actually
// acts on, the same "what needs me right now" pattern already proven
// on the owner dashboard. It gets the dominant width; quick actions
// and recent activity share a narrower secondary column.
//
// Ops redesign (28 October 2026): the frame is now the shared Ops
// primitives (components/ops/ops-primitives.tsx), so the console's
// pages share one card, one empty state, one figure tile and one
// heading rhythm.
//
// HONESTY ABOUT THE TWO NUMBERS (human decision, 28 October 2026):
// the KPI strip is a DAILY SNAPSHOT, computed by the nightly job at a
// known time, so it says when it was computed and compares with the
// snapshot a MONTH earlier (the backend's own comparison rule — the
// delta is measured against the latest snapshot that is at least
// thirty days old). The needs-attention queue is LIVE and is one row
// per issue, capped at the eleven most pressing ones — so it never
// claims to be a total. The two are different measures of different
// things, and the page says so instead of implying one trend line.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

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
    runOpsGlobalRead(
      "platform.metrics.summary",
      () => getPlatformMetricsSummary(),
      "ops_page",
    ),
    runOpsGlobalRead(
      "tenant.health.queue",
      () => getNeedsAttentionQueue(11),
      "ops_page",
    ),
    runOpsGlobalRead(
      "activity.list",
      () => listPlatformActivity({ limit: 5 }),
      "ops_page",
    ),
  ]);
  // A null global read means the actor was not authenticated at the
  // boundary. This page already redirected above, so this is unreachable
  // defence — never a silent empty dashboard.
  if (!metrics || !queue) redirect("/ops/login");
  const recent = activity?.rows ?? [];

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Overview"
        title="Aqua control plane"
        lede={
          <>
            Signed in as <span className="font-medium">{status.role}</span>.
          </>
        }
        meta={
          metrics.asOf ? (
            <>
              Daily snapshot computed {DATE_FMT.format(metrics.asOf)} IST
            </>
          ) : null
        }
      />

      {!metrics.asOf ? (
        <OpsPanel tone="pending" className="mt-6" title="No metrics snapshot yet">
          The platform.metrics-snapshot job runs nightly. The figures below
          are unavailable until it runs once; the needs-attention queue is
          live and does not depend on it.
        </OpsPanel>
      ) : (
        <OpsOverviewMetrics
          activeTenants={metrics.activeTenants}
          trialTenants={metrics.trialTenants}
          atRiskTenants={metrics.atRiskTenants}
          openOpsTasks={metrics.openOpsTasks}
        />
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <OpsSection
            title="Needs attention"
            subtitle="Live: one row per open issue, showing the eleven most pressing ones."
            actions={
              <span className="text-[12px] text-ink-3">
                {queue.length} {queue.length === 1 ? "item" : "items"}
              </span>
            }
          />
          {queue.length === 0 ? (
            <OpsEmptyState
              title="Nothing needs attention"
              body="Every tenant is healthy right now. The queue reads live tenant health, so it never goes stale."
            />
          ) : (
            <OpsCardFlush>
              {queue.map((item, i) => (
                <div
                  key={`${item.tenantId}-${item.text}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      {item.tenantName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-2">{item.text}</p>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <span className="text-[12px] text-ink-3 tabular-nums">
                      {item.ageDays != null ? `${item.ageDays}d` : "—"}
                    </span>
                    <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                      {SEVERITY_LABEL[item.severity]}
                    </StatusBadge>
                    <Link
                      href={`/ops/tenants/${item.tenantId}`}
                      className="text-[12px] font-medium text-[var(--accent-ink)] hover:underline underline-offset-2"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </OpsCardFlush>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <OpsSection title="Quick actions" />
            <div className="grid grid-cols-1 gap-2">
              <Link
                href="/ops/tenants"
                className="block rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
              >
                <p className="text-[13px] font-medium text-ink">Tenants</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  List every tenant, drill into settings, suspend or churn.
                </p>
              </Link>
              <Link
                href="/ops/features"
                className="block rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
              >
                <p className="text-[13px] font-medium text-ink">Feature catalogue</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Editable list of every feature Aqua ships.
                </p>
              </Link>
              <Link
                href="/ops/presets"
                className="block rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
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
                className="block rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
              >
                <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                  <ClipboardList size={13} strokeWidth={2} /> Leads
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Sales pipeline: qualification answers become the tenant&apos;s
                  preset and configuration.
                </p>
              </Link>
              {mockMessagingEnabled() ? (
                <Link
                  href="/ops/whatsapp"
                  className="block rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
                >
                  <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <MessageCircle size={13} strokeWidth={2} /> WhatsApp mock
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Non-production: send and receive mock messages through the
                    real pipeline.
                  </p>
                </Link>
              ) : null}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
                Recent activity
              </h2>
              <Link
                href="/ops/activity"
                className="flex items-center gap-1 text-[12px] font-medium text-[var(--accent-ink)] hover:underline underline-offset-2"
              >
                <Activity size={12} strokeWidth={2} /> View all
              </Link>
            </div>
            {recent.length === 0 ? (
              <OpsEmptyState title="No platform activity yet" />
            ) : (
              <OpsCardFlush>
                {recent.map((row) => (
                  <div key={row.id} className="border-b border-line px-4 py-3 last:border-b-0">
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
              </OpsCardFlush>
            )}
          </section>
        </div>
      </div>
    </OpsPage>
  );
}
