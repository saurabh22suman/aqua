import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";
import { listAllTenantsForSelector } from "@/db/platform-tenants";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";
import { normalizeActivityDate } from "@/components/ops/ops-activity-date";
import { OpsActivityList } from "@/components/ops/ops-activity-list";
import { OpsPage, OpsPageHeader } from "@/components/ops/ops-primitives";

/**
 * The audited read of the trail.
 *
 * A bound the reader refuses is the operator's link, not a server
 * fault, so the refusal is reported in the product's own words. The
 * audit row is written by the audited read itself, before the error
 * reaches the page.
 */
async function readActivity(
  action: string | undefined,
  tenantId: string | undefined,
  since: string | undefined,
  until: string | undefined,
  unreadable: boolean,
) {
  try {
    return await listPlatformActivityAction({ action, tenantId, since, until });
  } catch (error) {
    if (unreadable) {
      throw new Error("That date filter is not a real date.");
    }
    throw error;
  }
}

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

  // The bounds are NORMALISED ONCE: the query and the controls beside
  // it must name the same IST calendar day, including an old link that
  // still carries an instant. A bound that cannot be read is REFUSED —
  // never dropped into an unfiltered read. It is refused INSIDE the
  // audited read, so the refusal is recorded like every other
  // operation: the raw bound is handed over as it came, and the reader
  // refuses it instead of the page throwing before the operation was
  // ever audited.
  const sinceRaw = params.since ? normalizeActivityDate(params.since) : null;
  const untilRaw = params.until ? normalizeActivityDate(params.until) : null;
  const unreadable = Boolean(
    (params.since && !sinceRaw) || (params.until && !untilRaw),
  );
  const since = sinceRaw ?? (params.since || undefined);
  const until = untilRaw ?? (params.until || undefined);

  const [{ rows, total }, actions, tenants] = await Promise.all([
    readActivity(params.action || undefined, params.tenantId || undefined, since, until, unreadable),
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
            since,
            until,
          }}
        />
      </section>

      <section className="mt-5">
        <OpsActivityList rows={rows} />
      </section>
    </OpsPage>
  );
}
