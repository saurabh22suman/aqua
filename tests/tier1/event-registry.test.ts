import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  ACTIVITY_EVENT_NAMES,
  activityEventSchema,
} from "@/lib/events/registry";

// E-05 — the registry is a closed list. These assertions pin both
// halves: every declared name has a schema, and nothing outside the
// union is accepted. No DB involved — this is the boundary contract
// the ingest handler and emit both lean on.

function validEvent() {
  return {
    eventName: "session.attendance_marked",
    occurredAt: new Date("2026-10-15T04:30:00.000Z"),
    clientEventId: "registry-test-1",
    properties: {
      sessionId: uuidv7(),
      memberId: uuidv7(),
      status: "present",
    },
    source: "web",
  };
}

describe("E-05 — activity event registry", () => {
  it("declares at least one event and every declared name parses", () => {
    expect(ACTIVITY_EVENT_NAMES.length).toBeGreaterThan(0);
    for (const name of ACTIVITY_EVENT_NAMES) {
      const event = { ...validEvent(), eventName: name };
      expect(activityEventSchema.safeParse(event).success, name).toBe(true);
    }
  });

  it("rejects an unknown event_name", () => {
    const result = activityEventSchema.safeParse({
      ...validEvent(),
      eventName: "session.not_registered",
    });
    expect(result.success).toBe(false);
  });

  it("rejects undeclared properties (strict shape — the no-PII gate)", () => {
    const result = activityEventSchema.safeParse({
      ...validEvent(),
      properties: {
        sessionId: uuidv7(),
        memberId: uuidv7(),
        status: "present",
        memberName: "Aarav Sharma",
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires the idempotency key", () => {
    const withoutKey: Record<string, unknown> = { ...validEvent() };
    delete withoutKey.clientEventId;
    expect(activityEventSchema.safeParse(withoutKey).success).toBe(false);
  });

  it("coerces a JSON round-tripped occurredAt back to a Date (pg-boss payloads are strings)", () => {
    const parsed = activityEventSchema.parse(
      JSON.parse(JSON.stringify(validEvent())),
    );
    expect(parsed.occurredAt).toBeInstanceOf(Date);
  });
});
