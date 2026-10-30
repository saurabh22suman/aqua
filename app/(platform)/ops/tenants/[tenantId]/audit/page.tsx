import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { runOpsRead } from "@/lib/auth/ops-operation";
import { DATETIME_FMT, SectionHeader, ActivityDetail } from "../tenant-detail-shared";
import { OpsCardFlush, OpsEmptyState } from "@/components/ops/ops-primitives";

// PR4 (ops console improvements) — Audit tab, moved verbatim from
// the Overview page's "Recent activity" section.
//
// Ops redesign (28 October 2026): the event list is the shared Ops
// frame — one empty state, one divided list. The detail envelope
// stays readable, because the reason a change happened is the whole
// point of the tab.
export default async function TenantAuditPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  const detail = await runOpsRead(
    "tenant.detail",
    tenantId,
    () => getTenantDetail(asTenantId(tenantId)),
    "ops_page",
  );
  if (!detail) notFound();

  return (
    <section>
      <SectionHeader
        title="Recent activity"
        subtitle="Last 20 platform events scoped to this tenant"
      />
      {detail.recentActivity.length === 0 ? (
        <OpsEmptyState
          title="No activity yet"
          body="Status changes, suspensions, churns, and feature edits write to the audit log and surface here once they happen."
        />
      ) : (
        <OpsCardFlush>
          <ul>
            {detail.recentActivity.map((event) => (
              <li
                key={event.id}
                className="border-b border-line px-4 py-3 last:border-b-0"
              >
                <p className="font-mono text-[14px] text-ink">{event.action}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {DATETIME_FMT.format(event.createdAt)} IST
                </p>
                <ActivityDetail detail={event.detail} />
              </li>
            ))}
          </ul>
        </OpsCardFlush>
      )}
    </section>
  );
}
