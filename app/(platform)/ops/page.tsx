import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
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
import { cn } from "@/components/ui/cn";
import {
  classifySnapshot,
  snapshotMetaText,
} from "@/components/ops/reliability/snapshot-freshness";
import { SnapshotFreshnessNotice } from "@/components/ops/reliability/snapshot-freshness-notice";
import { OpsOverviewMetrics } from "./ops-overview-metrics";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";

export const metadata: Metadata = { title: "Platform operations" };

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
  attention: "Needs review",
  at_risk: "High priority",
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
        title="Platform operations"
        actions={<Link href="/ops/tenants" className="inline-flex min-h-11 items-center rounded-ctl border border-line bg-paper px-3 text-sm font-semibold text-ink">Find a tenant</Link>}
        meta={snapshotMetaText(snapshot)}
      />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <OpsSection
            title="Needs attention"
            subtitle="Live issues across tenants, ordered by priority"
            actions={
              <span className="text-[12px] text-ink-3">
                {queue.length} {queue.length === 1 ? "item" : "items"}
              </span>
            }
          />
          {queue.length === 0 ? (
            <OpsEmptyState
              title="Nothing needs attention"
              body="There are no open issues in the current checks for invoices, trials, activity, messages or change requests."
            />
          ) : (
            <OpsCardFlush>
              <ul>
              {queue.map((item, i) => (
                <li
                  key={`${item.tenantId}-${item.text}-${i}`}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0",
                    i === 0 && "border-s-4 border-s-[var(--accent-strong)] bg-deck/40",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{item.text}</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{item.tenantName}</p>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                      {SEVERITY_LABEL[item.severity]}
                    </StatusBadge>
                    <Link
                      href={`/ops/tenants/${item.tenantId}`}
                      aria-label={`Review tenant ${item.tenantName}: ${item.text}`}
                      className="inline-flex min-h-11 items-center text-[12px] font-medium text-[var(--accent-ink)] hover:underline underline-offset-2"
                    >
                      Review tenant
                    </Link>
                  </div>
                </li>
              ))}
              </ul>
            </OpsCardFlush>
          )}
        </section>

        <div className="space-y-6">
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

      <OptionalWorkspaceGuide
        startCollapsed
        title="A look around Ops"
        intro="Explore the overview at your own pace. This guide makes no changes."
        regionLabel="Optional Ops overview guide"
        itemLabel="Overview area"
        items={[
          { key: "snapshot", title: "Snapshot", detail: "The snapshot panel says when metrics are available and how recent they are." },
          { key: "attention", title: "Needs attention", detail: "This live list shows the most pressing items currently returned by the queue." },
          { key: "activity", title: "Recent activity", detail: "The activity panel shows recent platform activity." },
        ]}
      />
    </OpsPage>
  );
}
