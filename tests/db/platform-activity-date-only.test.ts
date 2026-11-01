// The platform activity read — DATE-ONLY bounds over the IST calendar
// day (31 Oct 2026, revision).
//
// The Ops activity filter is a DATE filter, so its bounds are calendar
// days in the operator's zone (IST). The reader must therefore treat
// `since="2026-10-28"` as the START of that IST day and `until` as the
// END of it — the whole day, down to its last microsecond, and not one
// microsecond of the next midnight.
//
// The legacy explicit-timestamp API is NOT changed: an offset-aware
// timestamp is still compared exactly, and its end is still inclusive
// at the instant it names.
//
// The privileged pool is used for FIXTURE SETUP only (the tenants and
// the synthetic audit rows). Every assertion runs against the real
// application service, on the application's own pool and role.
//
// This is a RED-phase file: it is expected to fail until the reader
// treats a date-only bound as an IST calendar day.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { listPlatformActivity } from "@/db/platform-activity";
import { dayRangeUtc, zonedWallTimeToInstant } from "@/lib/time/tz";
import { privilegedFixturePool as admin } from "./privileged-fixture";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const ACTION = `dateonly.window.${RUN}`;
const BOUNDARY_ACTION = `dateonly.boundary.${RUN}`;

const tenantA = uuidv7();
const tenantB = uuidv7();

/** An ISO instant with the given microsecond fraction, as Postgres stores it. */
function at(iso: string, micros: number): string {
  return `${iso.slice(0, 19)}.${String(micros).padStart(6, "0")}Z`;
}

/** The first microsecond of an IST calendar day. */
function dayStart(dateIso: string): string {
  return at(dayRangeUtc(dateIso, TZ).fromUtc.toISOString(), 0);
}

/** The last microsecond of an IST calendar day. */
function dayEnd(dateIso: string): string {
  const nextMidnight = dayRangeUtc(dateIso, TZ).toUtc;
  return at(new Date(nextMidnight.getTime() - 1).toISOString(), 999999);
}

/** Noon on an IST calendar day. */
function midday(dateIso: string): string {
  return at(zonedWallTimeToInstant(dateIso, "12:00", TZ).toISOString(), 0);
}

type Fixture = {
  key: string;
  action: string;
  at: string;
  tenant: string;
};

// One IST calendar day (28 October 2026) and its neighbours, plus one
// row in another tenant for the narrowing case.
const WINDOW_ROWS: Fixture[] = [
  { key: "dayStart", action: ACTION, at: dayStart("2026-10-28"), tenant: tenantA },
  { key: "lastMicrosecond", action: ACTION, at: dayEnd("2026-10-28"), tenant: tenantA },
  { key: "midDay", action: ACTION, at: midday("2026-10-28"), tenant: tenantA },
  { key: "nextMidnight", action: ACTION, at: dayStart("2026-10-29"), tenant: tenantA },
  { key: "nextDay", action: ACTION, at: midday("2026-10-29"), tenant: tenantA },
  { key: "previousDay", action: ACTION, at: midday("2026-10-27"), tenant: tenantA },
  { key: "otherTenant", action: ACTION, at: midday("2026-10-28"), tenant: tenantB },
];

// A leap day, a month edge and a year edge.
const BOUNDARY_ROWS: Fixture[] = [
  { key: "leapDay", action: BOUNDARY_ACTION, at: dayStart("2028-02-29"), tenant: tenantA },
  { key: "afterLeapDay", action: BOUNDARY_ACTION, at: dayStart("2028-03-01"), tenant: tenantA },
  { key: "monthStart", action: BOUNDARY_ACTION, at: dayStart("2026-11-01"), tenant: tenantA },
  { key: "monthEnd", action: BOUNDARY_ACTION, at: dayEnd("2026-10-31"), tenant: tenantA },
  { key: "yearStart", action: BOUNDARY_ACTION, at: dayStart("2027-01-01"), tenant: tenantA },
  { key: "yearEnd", action: BOUNDARY_ACTION, at: dayEnd("2026-12-31"), tenant: tenantA },
];

const keysById = new Map<string, string>();

async function writeRow(action: string, tenantId: string, instant: string) {
  const id = uuidv7();
  await admin.query(
    `insert into platform_audit_log
       (id, actor_id, tenant_id, action, target_type, target_id, detail, created_at)
     values ($1::uuid, null, $2::uuid, $3, 'tenant', $1::uuid, '{}'::jsonb, $4::timestamptz)`,
    [id, tenantId, action, instant],
  );
  return id;
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, timezone)
     values ($1::uuid, $2, $3, $4), ($5::uuid, $6, $7, $4)`,
    [
      tenantA,
      `dateonly-a-${RUN}`,
      "Date Only A",
      TZ,
      tenantB,
      `dateonly-b-${RUN}`,
      "Date Only B",
    ],
  );
  for (const row of [...WINDOW_ROWS, ...BOUNDARY_ROWS]) {
    keysById.set(await writeRow(row.action, row.tenant, row.at), row.key);
  }
});

afterAll(async () => {
  await admin.query(
    "delete from platform_audit_log where action = any($1::text[])",
    [[ACTION, BOUNDARY_ACTION]],
  );
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await admin.end();
});

/** The fixture keys the service returned, and the total it counted. */
async function read(filter: Parameters<typeof listPlatformActivity>[0]) {
  const result = await listPlatformActivity(filter);
  expect(
    result.total,
    "the counted total does not match the rows returned",
  ).toBe(result.rows.length);
  return {
    keys: result.rows.map((row) => keysById.get(row.id) ?? row.id),
    rows: result.rows,
  };
}

describe("the platform activity read — a date-only bound is an IST day", () => {
  it("covers the whole IST day, down to its last microsecond", async () => {
    const { keys } = await read({
      action: ACTION,
      since: "2026-10-28",
      until: "2026-10-28",
    });
    expect(keys.sort()).toEqual(
      ["dayStart", "lastMicrosecond", "midDay", "otherTenant"].sort(),
    );
  });

  it("keeps the stored instants exact", async () => {
    const { rows } = await read({
      action: ACTION,
      since: "2026-10-28",
      until: "2026-10-28",
    });
    const byKey = new Map(rows.map((row) => [keysById.get(row.id)!, row]));
    expect(byKey.get("dayStart"), "the IST midnight row is missing").toBeTruthy();
    expect(byKey.get("dayStart")!.createdAt.toISOString()).toBe(
      "2026-10-27T18:30:00.000Z",
    );
    expect(
      byKey.get("lastMicrosecond")!.createdAt.toISOString(),
    ).toBe("2026-10-28T18:29:59.999Z");
  });

  it("starts the window at the IST midnight of the chosen day", async () => {
    const { keys } = await read({ action: ACTION, since: "2026-10-28" });
    expect(keys.sort()).toEqual(
      [
        "dayStart",
        "lastMicrosecond",
        "midDay",
        "otherTenant",
        "nextMidnight",
        "nextDay",
      ].sort(),
    );
  });

  it("ends the window at the end of the chosen IST day, not at the next midnight", async () => {
    const { keys } = await read({ action: ACTION, until: "2026-10-28" });
    expect(keys.sort()).toEqual(
      ["dayStart", "lastMicrosecond", "midDay", "otherTenant", "previousDay"].sort(),
    );
  });

  it("narrows to the selected tenant inside the same day", async () => {
    const { keys } = await read({
      action: ACTION,
      tenantId: tenantB,
      since: "2026-10-28",
      until: "2026-10-28",
    });
    expect(keys).toEqual(["otherTenant"]);
  });

  it("covers a leap day as one whole IST day", async () => {
    const { keys } = await read({
      action: BOUNDARY_ACTION,
      since: "2028-02-29",
      until: "2028-02-29",
    });
    expect(keys).toEqual(["leapDay"]);
  });

  it("keeps a month edge on two separate IST days", async () => {
    expect(
      (
        await read({
          action: BOUNDARY_ACTION,
          since: "2026-11-01",
          until: "2026-11-01",
        })
      ).keys,
    ).toEqual(["monthStart"]);
    expect(
      (
        await read({
          action: BOUNDARY_ACTION,
          since: "2026-10-31",
          until: "2026-10-31",
        })
      ).keys,
    ).toEqual(["monthEnd"]);
  });

  it("keeps a year edge on two separate IST days", async () => {
    expect(
      (
        await read({
          action: BOUNDARY_ACTION,
          since: "2027-01-01",
          until: "2027-01-01",
        })
      ).keys,
    ).toEqual(["yearStart"]);
    expect(
      (
        await read({
          action: BOUNDARY_ACTION,
          since: "2026-12-31",
          until: "2026-12-31",
        })
      ).keys,
    ).toEqual(["yearEnd"]);
  });
});

describe("the platform activity read — what it refuses", () => {
  it("refuses a bound that is not a real calendar date", async () => {
    for (const bad of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-1-1",
      "not-a-date",
      "",
    ]) {
      let rejected = false;
      try {
        await listPlatformActivity({ action: ACTION, since: bad });
      } catch {
        rejected = true;
      }
      expect(rejected, `since="${bad}" was accepted as a bound`).toBe(true);
    }
  });

  it("still filters by the action", async () => {
    const result = await listPlatformActivity({ action: ACTION });
    expect(result.total).toBe(WINDOW_ROWS.length);
  });
});

describe("the platform activity read — the legacy explicit timestamp API", () => {
  it("keeps the start comparison exact", async () => {
    const { keys } = await read({
      action: ACTION,
      since: "2026-10-27T18:30:00.000Z",
    });
    expect(keys.sort()).toEqual(
      [
        "dayStart",
        "lastMicrosecond",
        "midDay",
        "otherTenant",
        "nextMidnight",
        "nextDay",
      ].sort(),
    );
  });

  it("keeps the end comparison exact AND inclusive at the instant it names", async () => {
    const { keys } = await read({
      action: ACTION,
      until: "2026-10-27T18:30:00.000Z",
    });
    expect(keys.sort()).toEqual(["dayStart", "previousDay"].sort());
  });

  it("keeps a legacy end that names the next midnight inclusive", async () => {
    const { keys } = await read({
      action: ACTION,
      until: "2026-10-28T18:30:00.000Z",
    });
    expect(keys.sort()).toEqual(
      [
        "dayStart",
        "lastMicrosecond",
        "midDay",
        "otherTenant",
        "previousDay",
        "nextMidnight",
      ].sort(),
    );
  });
});
