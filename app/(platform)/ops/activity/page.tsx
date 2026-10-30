import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";
import { listAllTenantsForSelector } from "@/db/platform-tenants";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";
import { OpsActivityList } from "@/components/ops/ops-activity-list";
import { OpsPage, OpsPageHeader } from "@/components/ops/ops-primitives";

// Phase 3.9 — platform activity log. Filterable, append-only
// view of platform_audit_log (the cross-tenant audit trail every
// platform-side mutation writes to). One dominant element per
// screen — the list itself.
//
// Ops redesign (28 October 2026): the tenant filter is a PICKER over
// the real tenant list, labelled by name. It used to be a free-text
// UUID box, which an operator could not use: the person investigating a
// problem knows the club's name, not its id. The date filter also
// gained the 24-hour / 7-day / 30-day ranges, which is how the
// question is actually asked.
//
// The count is the number of events matching the ACTIVE filters, and
// the page says so — a filtered list never reads as the whole trail.
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
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const params = await searchParams;

  const [{ rows, total }, actions, tenants] = await Promise.all([
    listPlatformActivityAction({
      action: params.action || undefined,
      tenantId: params.tenantId || undefined,
      since: params.since || undefined,
      until: params.until || undefined,
    }),
    listKnownActionsAction(),
    runOpsGlobalRead("tenant.selector.list", () => listAllTenantsForSelector(), "ops_page"),
  ]);
  if (!tenants) redirect("/ops/login");

  const hasFilters = Boolean(
    params.action || params.tenantId || params.since || params.until,
  );

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Activity log"
        title="Activity"
        lede={
          rows.length < total
            ? // The list is the newest slice of the matching events, not
              // all of them. Say which is which, so a filter that
              // matches 118 events is not read as 118 events on screen.
              `Cross-tenant audit trail. Showing latest ${rows.length} of ${total} matching events.`
            : `Cross-tenant audit trail. ${total} ${total === 1 ? "event" : "events"} ${hasFilters ? "match the current filters" : "in the trail"}.`
        }
      />

      <section className="mt-6">
        <OpsActivityFilter
          actions={actions}
          tenants={tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))}
          initial={{
            action: params.action,
            tenantId: params.tenantId,
            since: params.since,
            until: params.until,
          }}
        />
      </section>

      <section className="mt-5">
        <OpsActivityList rows={rows} />
      </section>
    </OpsPage>
  );
}
