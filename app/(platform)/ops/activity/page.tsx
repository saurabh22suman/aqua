import { redirect } from "next/navigation";
import { z } from "zod";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";
import { listAllTenantsForSelector } from "@/db/platform-tenants";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { OPS_OUTCOMES } from "@/lib/ops-outcomes";
import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";
import { normalizeActivityDate } from "@/components/ops/ops-activity-date";
import { OpsActivityList } from "@/components/ops/ops-activity-list";
import { OpsPage, OpsPageHeader, OpsPanel, OpsTextLink } from "@/components/ops/ops-primitives";

/**
 * The audited read of the trail.
 *
 * A bound the reader refuses is the operator's link, not a server
 * fault, so the refusal is reported in the product's own words. The
 * audit row is written by the audited read itself, before the error
 * reaches the page.
 *
 * Ops completion 2026-11-09 — the investigation parameters travel with
 * the SAME boundary and the SAME audited operation (`activity.list`), so
 * an investigation read still writes exactly one audit row. `refusal` is
 * the product's own sentence for a parameter the reader refused: when it
 * is set, the page shows that refusal without raw validation text and never
 * falls back to the unfiltered trail.
 */
type ActivityRead =
  | { kind: "loaded"; value: Awaited<ReturnType<typeof listPlatformActivityAction>> }
  | { kind: "refused"; message: string };

async function readActivity(
  action: string | undefined,
  tenantId: string | undefined,
  since: string | undefined,
  until: string | undefined,
  investigation: { actorId?: string; correlationId?: string; outcome?: string },
  refusal: string | null,
): Promise<ActivityRead> {
  try {
    const value = await listPlatformActivityAction({
      action,
      tenantId,
      since,
      until,
      ...investigation,
    });
    return refusal ? { kind: "refused", message: refusal } : { kind: "loaded", value };
  } catch (error) {
    if (refusal) {
      return { kind: "refused", message: refusal };
    }
    throw error;
  }
}

const UUID = z.string().uuid();

export default async function PlatformActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    tenantId?: string;
    since?: string;
    until?: string;
    actorId?: string;
    correlationId?: string;
    outcome?: string;
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

  // The investigation parameters are checked the same way. An empty
  // parameter is simply no parameter; a parameter that cannot be read
  // is refused, and the refusal names it.
  const actorRaw = params.actorId?.trim() ?? "";
  const correlationRaw = params.correlationId?.trim() ?? "";
  const outcomeRaw = params.outcome?.trim() ?? "";
  const actorId =
    actorRaw && UUID.safeParse(actorRaw).success ? actorRaw : undefined;
  const correlationId =
    correlationRaw && UUID.safeParse(correlationRaw).success
      ? correlationRaw
      : undefined;
  const outcome =
    outcomeRaw && (OPS_OUTCOMES as readonly string[]).includes(outcomeRaw)
      ? outcomeRaw
      : undefined;
  const investigationRefusal = actorRaw && !actorId
    ? "That actor filter is not a real id."
    : correlationRaw && !correlationId
      ? "That operation reference is not a real id."
      : outcomeRaw && !outcome
        ? "That outcome filter is not one the platform records."
        : null;

  const [activity, actions, tenants] = await Promise.all([
    readActivity(
      params.action || undefined,
      params.tenantId || undefined,
      since,
      until,
      {
        ...(actorRaw ? { actorId: actorRaw } : {}),
        ...(correlationRaw ? { correlationId: correlationRaw } : {}),
        ...(outcomeRaw ? { outcome: outcomeRaw } : {}),
      },
      investigationRefusal ?? (unreadable ? "That date filter is not a real date." : null),
    ),
    listKnownActionsAction(),
    runOpsGlobalRead("tenant.selector.list", () => listAllTenantsForSelector(), "ops_page"),
  ]);
  if (!tenants) redirect("/ops/login");

  const hasFilters = Boolean(
    params.action ||
      params.tenantId ||
      params.since ||
      params.until ||
      params.actorId ||
      params.correlationId ||
      params.outcome,
  );

  return (
    <OpsPage>
      <OpsPageHeader
        title="Activity"
        lede={
          activity.kind === "refused"
            ? "The activity trail could not be filtered with this link."
            : activity.value.rows.length < activity.value.total
              ? `Cross-tenant audit trail. Showing latest ${activity.value.rows.length} of ${activity.value.total} matching events.`
              : `Cross-tenant audit trail. ${activity.value.total} ${activity.value.total === 1 ? "event" : "events"} ${hasFilters ? "match the current filters" : "in the trail"}.`
        }
      />

      {activity.kind === "refused" ? (
        <OpsPanel tone="error" role="alert" title="Activity filters could not be read" className="mt-6">
          <p>{activity.message}</p>
          <p className="mt-2"><OpsTextLink href="/ops/activity">Clear filters and return to activity</OpsTextLink></p>
        </OpsPanel>
      ) : (
      <>
      <section className="mt-6">
        <OpsActivityFilter
          actions={actions}
          tenants={tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))}
          outcomes={OPS_OUTCOMES}
          initial={{
            action: params.action,
            tenantId: params.tenantId,
            since,
            until,
            actorId,
            correlationId,
            outcome,
          }}
        />
      </section>

      <section className="mt-5">
        <OpsActivityList rows={activity.value.rows} />
      </section>
      </>
      )}
    </OpsPage>
  );
}
