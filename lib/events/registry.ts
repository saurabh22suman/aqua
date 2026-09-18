import { z } from "zod";

// E-05 — the `activity_events` event registry (architecture.md §8.11):
// a closed, versioned list of event names with schema-validated
// properties. Adding an event means adding an entry here — nothing
// ingests a name this file doesn't declare, and every `properties`
// object is `.strict()` so a caller cannot smuggle an unplanned field
// (the "no PII" rule is enforced by the shape being closed, not by a
// reviewer noticing a name).
//
// The registry is the TS union + zod the plan asks for:
// `ACTIVITY_EVENT_NAMES` is the union, `activityEventSchema` is the
// zod discriminated union. A test asserts the two agree, so a name
// added to the union without a schema (or vice versa) fails loudly.

export const ACTIVITY_EVENT_NAMES = ["session.attendance_marked"] as const;
export type ActivityEventName = (typeof ACTIVITY_EVENT_NAMES)[number];

export const ACTIVITY_SOURCES = ["web", "job", "ops", "api"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const ACTIVITY_ACTOR_KINDS = [
  "user",
  "staff",
  "system",
  "job",
  "platform",
  "support",
] as const;
export type ActivityActorKind = (typeof ACTIVITY_ACTOR_KINDS)[number];

// Shared envelope for every event. `occurredAt` is the business/client
// clock (data is partitioned by it); the server clock lands in the
// `received_at` column at insert time. `clientEventId` is the caller's
// idempotency key — for the offline register that is the existing
// per-mark clientId, stable across retries.
const envelope = {
  occurredAt: z.coerce.date(),
  clientEventId: z.string().min(1).max(255),
  actorId: z.string().uuid().optional(),
  actorKind: z.enum(ACTIVITY_ACTOR_KINDS).optional(),
  sessionId: z.string().max(255).optional(),
  requestId: z.string().uuid().optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().uuid().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(ACTIVITY_SOURCES),
};

// First event: a register mark. Properties are deliberately opaque ids
// and a status enum — no member name, no DOB, no phone, no free text.
const sessionAttendanceMarked = z
  .object({
    eventName: z.literal("session.attendance_marked"),
    ...envelope,
    properties: z
      .object({
        sessionId: z.string().uuid(),
        memberId: z.string().uuid(),
        status: z.enum(["present", "absent", "late"]),
      })
      .strict(),
  })
  .strict();

export const activityEventSchema = z.discriminatedUnion("eventName", [
  sessionAttendanceMarked,
]);

export type ActivityEventInput = z.infer<typeof activityEventSchema>;
export type SessionAttendanceMarkedEvent = z.infer<typeof sessionAttendanceMarked>;

export function isActivityEventName(name: string): name is ActivityEventName {
  return (ACTIVITY_EVENT_NAMES as readonly string[]).includes(name);
}
