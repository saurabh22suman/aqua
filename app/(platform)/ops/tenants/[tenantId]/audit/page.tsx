import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { DATETIME_FMT, SectionHeader, ActivityDetail } from "../tenant-detail-shared";

// PR4 (ops console improvements) — Audit tab, moved verbatim from the
// Overview page's "Recent activity" section.
export default async function TenantAuditPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  requireUuidParam(tenantId);
  const detail = await getTenantDetail(asTenantId(tenantId));
  if (!detail) notFound();

  return (
    <section>
      <SectionHeader
        title="Recent activity"
        subtitle="Last 20 platform events scoped to this tenant"
      />
      {detail.recentActivity.length === 0 ? (
        <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
          <p className="text-[14px] font-medium text-ink">No activity yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            Status changes, suspensions, churns, and feature edits write
            to the audit log and surface here once they happen.
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
  );
}
