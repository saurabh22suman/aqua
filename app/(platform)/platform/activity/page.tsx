import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";
import { ActivityFilterBar } from "@/components/activity-filter-bar";
import { ActivityList } from "@/components/activity-list";

// Phase 3.9 — platform activity log. Filterable, append-only
// view of platform_audit_log (the cross-tenant audit trail every
// platform-side mutation writes to). One dominant element per
// screen — the list itself. The filter bar above the list
// carries action / tenant / date selectors; the list renders
// every event with its detail envelope inline.
export default async function PlatformActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    tenantId?: string;
    since?: string;
    until?: string;
  }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/platform/login");

  const params = await searchParams;

  const [{ rows, total }, actions] = await Promise.all([
    listPlatformActivityAction({
      action: params.action || undefined,
      tenantId: params.tenantId || undefined,
      since: params.since || undefined,
      until: params.until || undefined,
    }),
    listKnownActionsAction(),
  ]);

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-[28px] font-semibold text-marine">
        Activity
      </h1>
      <p className="mt-2 text-[13px] text-ink-3">
        Cross-tenant audit trail. {total} events match the current filters.
      </p>

      <section className="mt-6">
        <ActivityFilterBar
          actions={actions}
          initial={{
            action: params.action,
            tenantId: params.tenantId,
            since: params.since,
            until: params.until,
          }}
        />
      </section>

      <section className="mt-6">
        <ActivityList rows={rows} />
      </section>
    </div>
  );
}
