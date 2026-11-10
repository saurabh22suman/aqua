import Link from "next/link";
import { redirect } from "next/navigation";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
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
import { OpsTaskList } from "@/components/ops/console/ops-task-list";
import {
  classifySnapshot,
  snapshotMetaText,
} from "@/components/ops/reliability/snapshot-freshness";
import { SnapshotFreshnessNotice } from "@/components/ops/reliability/snapshot-freshness-notice";
import { OpsOverviewMetrics } from "./ops-overview-metrics";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";

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
//
// Ops reliability (9 November 2026): the page now also says whether
// that snapshot moment is still recent. The threshold (30 hours) is a
// local DISPLAY assumption, not an SLO, and the freshness region lives
// in components/ops/reliability/. A stale snapshot is FLAGGED, never
// hidden, and the live queue is never painted with the snapshot's age.

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
  // The snapshot's OWN timestamp decides what the console may say about
  // its age: no health read, no worker, no backup — this console holds
  // no such evidence, and none of it is implied here.
  const snapshot = classifySnapshot(metrics.asOf, new Date());

  return (
    <OpsPage>
      <OpsPageHeader
        title="Aqua control plane"
        lede={
          <>
            Signed in as <span className="font-medium">{status.role}</span>.
          </>
        }
        meta={snapshotMetaText(snapshot)}
      />

      <OptionalWorkspaceGuide
        startCollapsed
        title="A look around Ops"
        intro="Explore the overview at your own pace. This guide makes no changes."
        regionLabel="Optional Ops overview guide"
        itemLabel="Overview area"
        items={[
          { key: "snapshot", title: "Snapshot", detail: "The snapshot panel says when metrics are available and how recent they are." },
          { key: "attention", title: "Needs attention", detail: "This live list shows the most pressing items currently returned by the queue." },
          { key: "tasks", title: "Quick actions", detail: "The task list shows the destinations available in this console." },
          { key: "activity", title: "Recent activity", detail: "The activity panel shows recent platform activity." },
        ]}
      />
      <SnapshotFreshnessNotice snapshot={snapshot} />

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
              body="No tenant currently matches these checks — zero members, overdue invoices, an expiring trial, no recent activity, failed messages or a pending change request. An empty queue is not a statement that every tenant is healthy, and it does not cover anything these checks do not look at."
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
            <OpsSection
              title="Quick actions"
              subtitle="Where to go next, grouped by task."
            />
            <OpsTaskList
              role={status.role}
              includeWhatsApp={mockMessagingEnabled()}
            />
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
