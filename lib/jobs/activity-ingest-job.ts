import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { activityEvents } from "@/db/schema";
import {
  activityEventSchema,
  type ActivityEventInput,
} from "@/lib/events/registry";
import { asUserId, type TenantId } from "@/lib/ids";

// E-05 — the ingest consumer for the activity_events stream
// (architecture.md §8.11: "ingest asynchronously (pg-boss batch),
// never inside a business transaction").
//
// `activity.ingest` is a global queue: there is no per-tenant cron
// schedule (unlike sessions.generate et al.) because events are
// produced by user actions, not by the clock. db/deploy.ts creates
// the queue once at deploy time; worker/index.ts registers the
// handler; lib/events/emit.ts is the only producer. Each job carries
// its own tenantId in `data` — this handler never enumerates tenants
// (the same cross-tenant scheduling rule every worker job follows).
//
// The handler is the trust boundary for queued data: pg-boss payloads
// are JSON that must be treated as untrusted input, so every event is
// re-validated against the registry before any DB work. A batch with
// an unknown event_name (or malformed properties) is rejected whole —
// no partial insert, so a poisoned payload can't smuggle itself in
// alongside valid events. pg-boss retries then dead-letter it.
//
// Delivery is at-least-once: the insert is `on conflict (tenant_id,
// client_event_id, occurred_at) do nothing`, so a redelivered job
// (retry, worker restart, duplicate emit) inserts exactly one row.
// That idempotency depends on the producer resending the ORIGINAL
// occurred_at for a given client_event_id — see the migration's
// partition-key note.

export const ACTIVITY_INGEST_QUEUE = "activity.ingest";

export type ActivityIngestJobData = {
  tenantId: string;
  events: ActivityEventInput[];
};

// Takes `unknown[]` on purpose: the caller (worker) hands over
// deserialized JSON, not a type assertion. Returns the number of rows
// actually inserted (duplicates are skipped, not errors).
export async function runActivityIngestJob(
  tenantId: TenantId,
  rawEvents: unknown[],
): Promise<number> {
  const events = rawEvents.map((event) => activityEventSchema.parse(event));
  if (events.length === 0) return 0;

  return withTenant(tenantId, async (tx) => {
    const inserted = await tx
      .insert(activityEvents)
      .values(
        events.map((event) => ({
          id: uuidv7(),
          tenantId,
          occurredAt: event.occurredAt,
          actorId: event.actorId === undefined ? undefined : asUserId(event.actorId),
          actorKind: event.actorKind,
          sessionId: event.sessionId,
          requestId: event.requestId,
          eventName: event.eventName,
          entityType: event.entityType,
          entityId: event.entityId,
          properties: event.properties,
          context: event.context ?? {},
          source: event.source,
          clientEventId: event.clientEventId,
        })),
      )
      .onConflictDoNothing({
        target: [
          activityEvents.tenantId,
          activityEvents.clientEventId,
          activityEvents.occurredAt,
        ],
      })
      .returning({ id: activityEvents.id });

    return inserted.length;
  });
}
