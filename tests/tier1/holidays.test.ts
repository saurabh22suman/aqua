import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, members, batches } from "@/db/schema";
import { sessions } from "@/db/schema/scheduling";
import { tenantHolidays } from "@/db/schema/tenant-holidays";
import {
  addHoliday,
  removeHoliday,
  listHolidaysInRange,
  isHoliday,
} from "@/lib/services/holidays";
import { generateSessions } from "@/lib/jobs/session-generator";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let programId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Holiday Test', $3)",
    [tenantId, "holiday-" + RUN, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    await tx.insert(locations).values({ tenantId, name: "Main", isPrimary: true });
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Holiday Program" })
      .returning({ id: programs.id });
    programId = prog!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(tenantHolidays).where(eq(tenantHolidays.tenantId, tenantId));
      await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
      await tx.delete(members).where(eq(members.tenantId, tenantId));
      await tx.delete(batches).where(eq(batches.tenantId, tenantId));
      await tx.delete(programs).where(eq(programs.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.delete(tenantHolidays).where(eq(tenantHolidays.tenantId, tenantId));
    await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
  });
});

describe("addHoliday / removeHoliday (Phase R.3)", () => {
  it("adds a one-off holiday", async () => {
    const result = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Independence Day", holidayDate: "2027-08-15" },
    );
    expect(result.kind).toBe("ok");
  });

  it("rejects a duplicate one-off holiday", async () => {
    const first = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Diwali A", holidayDate: "2027-11-08" },
    );
    expect(first.kind).toBe("ok");
    const second = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Diwali B", holidayDate: "2027-11-08" },
    );
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.code).toBe("duplicate");
    }
  });

  it("allows a recurring holiday to be added once per tenant per month-day", async () => {
    const a = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Republic A", holidayDate: "2027-01-26", recurringYearly: true },
    );
    const b = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Republic B", holidayDate: "2028-01-26", recurringYearly: true },
    );
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("error");
    if (b.kind === "error") expect(b.code).toBe("duplicate");
  });

  it("removes a holiday", async () => {
    const add = await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Throwaway", holidayDate: "2027-09-09" },
    );
    expect(add.kind).toBe("ok");
    if (add.kind !== "ok") return;
    const remove = await removeHoliday(
      { tenantId, userId: SYSTEM_USER },
      { holidayId: add.holidayId },
    );
    expect(remove.kind).toBe("ok");
  });

  it("rejects removing a non-existent holiday", async () => {
    const result = await removeHoliday(
      { tenantId, userId: SYSTEM_USER },
      { holidayId: uuidv7() },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("not_found");
    }
  });
});

describe("isHoliday (Phase R.3)", () => {
  it("matches a one-off date exactly", () => {
    expect(
      isHoliday("2027-08-15", {
        oneOff: new Set(["2027-08-15"]),
        recurring: new Set(),
      }),
    ).toBe(true);
    expect(
      isHoliday("2027-08-16", {
        oneOff: new Set(["2027-08-15"]),
        recurring: new Set(),
      }),
    ).toBe(false);
  });

  it("matches a recurring holiday by month-day across years", () => {
    const h = { oneOff: new Set<string>(), recurring: new Set(["08-15"]) };
    expect(isHoliday("2027-08-15", h)).toBe(true);
    expect(isHoliday("2028-08-15", h)).toBe(true);
    expect(isHoliday("2027-08-16", h)).toBe(false);
  });
});

describe("listHolidaysInRange (Phase R.3)", () => {
  it("returns the active set for the tenant", async () => {
    await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "One-off", holidayDate: "2027-06-01" },
    );
    await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "Recurring", holidayDate: "2027-12-25", recurringYearly: true },
    );
    const result = await listHolidaysInRange(
      { tenantId, userId: SYSTEM_USER },
      "2027-06-01",
      "2027-12-31",
    );
    expect(result.oneOff.has("2027-06-01")).toBe(true);
    expect(result.recurring.has("12-25")).toBe(true);
  });
});

describe("session generator + holidays (Phase R.3)", () => {
  it("skips a session on a tenant holiday date", async () => {
    // Add a batch that runs every day
    let batchId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "All-day batch",
          capacity: 10,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "07:00",
          endTime: "08:00",
        })
        .returning({ id: batches.id });
      batchId = b!.id;
    });

    // Pick a future date 5 days out and mark it as a one-off
    // holiday, then run generation for 1 day.
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const dateStr = future.toISOString().slice(0, 10);
    const weekday = future.getUTCDay();
    // Ensure the batch's daysOfWeek includes this weekday
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(batches)
        .set({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })
        .where(eq(batches.id, batchId));
    });
    void weekday;

    await addHoliday(
      { tenantId, userId: SYSTEM_USER },
      { name: "On that day", holidayDate: dateStr },
    );

    // Run generation manually, but constraining to a single day
    // is non-trivial in the existing service. Instead: use the
    // holidays service directly and verify the generator's
    // isHoliday check fires.
    const result = await withTenant(tenantId, async (tx) => {
      const created = await generateSessions(tx, tenantId, TZ);
      return created;
    });
    void result;

    // The batch's session for dateStr must NOT exist (the
    // generator skipped it because the date is a one-off
    // holiday). All other dates in the 28-day horizon would
    // have sessions — but our test relies on the skip
    // specifically.
    const allRows = await withTenant(tenantId, async (tx) =>
      tx
        .select({ date: sessions.sessionDate })
        .from(sessions)
        .where(eq(sessions.batchId, batchId)),
    );
    const dateStrs = allRows.map((r) => r.date);
    expect(dateStrs).not.toContain(dateStr);
    // And at least one OTHER date in the horizon has a session
    // (proves the generator ran end-to-end and the skip was
    // specifically holiday-driven, not a config error).
    expect(dateStrs.length).toBeGreaterThan(0);
  });
});

void sql;
