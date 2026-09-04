import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, members, batches } from "@/db/schema";
import { sessions } from "@/db/schema/scheduling";
import { makeupCredits } from "@/db/schema/makeup-credits";
import { grantMakeupCredit, redeemMakeupCredit } from "@/lib/services/makeup";
import { asTenantId, asUserId, asMemberId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";
let memberId = "";
let sessionId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Makeup Test', $3)",
    [tenantId, "makeup-" + RUN, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Makeup Program" })
      .returning({ id: programs.id });
    programId = prog!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(makeupCredits).where(eq(makeupCredits.tenantId, tenantId));
      await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
      await tx.delete(members).where(eq(members.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(batches).where(eq(batches.tenantId, tenantId));
      await tx.delete(programs).where(eq(programs.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.delete(makeupCredits).where(eq(makeupCredits.tenantId, tenantId));
    await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
    await tx.delete(members).where(eq(members.tenantId, tenantId));
  });

  // Member + session.
  const nextDate = new Date();
  nextDate.setUTCDate(nextDate.getUTCDate() + 5);
  const dateStr = nextDate.toISOString().slice(0, 10);

  await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Makeup Subject", dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [m] = await tx
      .insert(members)
      .values({
        tenantId,
        personId: p!.id,
        locationId,
        memberCode: "MKP-" + RUN + "-" + p!.id.slice(0, 4).replace(/-/g, ""),
        status: "active",
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      })
      .returning({ id: members.id });
    memberId = m!.id;

    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Makeup Batch",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    const [s] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId: b!.id,
        sessionDate: dateStr,
        startsAt: new Date(dateStr + "T07:00:00Z"),
        endsAt: new Date(dateStr + "T08:00:00Z"),
        status: "scheduled",
      })
      .returning({ id: sessions.id });
    sessionId = s!.id;
  });
});

describe("grantMakeupCredit (Phase R.7)", () => {
  it("grants a credit for a source absence", async () => {
    const result = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.memberId).toBe(memberId);
      expect(result.sourceSessionId).toBe(sessionId);
    }
  });

  it("rejects a second grant for the same source absence", async () => {
    const first = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    expect(first.kind).toBe("ok");
    const second = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.code).toBe("already_has_credit");
    }
  });

  it("rejects a source session that doesn't belong to this tenant", async () => {
    const result = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: uuidv7() },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("source_session_not_found");
    }
  });

  it("default expires_at is 60 days out", async () => {
    const result = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    expect(result.kind).toBe("ok");
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select({ expiresAt: makeupCredits.expiresAt })
        .from(makeupCredits)
        .where(eq(makeupCredits.tenantId, tenantId)),
    );
    const delta = rows[0]!.expiresAt.getTime() - Date.now();
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    expect(delta).toBeGreaterThan(sixtyDays - 60_000);
    expect(delta).toBeLessThan(sixtyDays + 60_000);
  });
});

describe("redeemMakeupCredit (Phase R.7)", () => {
  it("redeems a granted credit against a target session", async () => {
    const grant = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    expect(grant.kind).toBe("ok");

    // Create a target session (different from the source)
    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + 7);
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    let targetId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "Target Batch",
          capacity: 10,
          daysOfWeek: [2, 4, 6],
          startTime: "17:00",
          endTime: "18:00",
        })
        .returning({ id: batches.id });
      const [t] = await tx
        .insert(sessions)
        .values({
          tenantId,
          batchId: b!.id,
          sessionDate: targetDateStr,
          startsAt: new Date(targetDateStr + "T17:00:00Z"),
          endsAt: new Date(targetDateStr + "T18:00:00Z"),
        })
        .returning({ id: sessions.id });
      targetId = t!.id;
    });

    const redeem = await redeemMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, targetSessionId: targetId },
    );
    expect(redeem.kind).toBe("ok");

    // Verify the row went to 'redeemed' with the target id.
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select({
          status: makeupCredits.status,
          redeemedSessionId: makeupCredits.redeemedSessionId,
        })
        .from(makeupCredits)
        .where(eq(makeupCredits.tenantId, tenantId)),
    );
    expect(rows[0]!.status).toBe("redeemed");
    expect(rows[0]!.redeemedSessionId).toBe(targetId);
  });

  it("rejects double-redeem of the same credit", async () => {
    await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId },
    );
    const first = await redeemMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, targetSessionId: sessionId },
    );
    expect(first.kind).toBe("ok");
    const second = await redeemMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, targetSessionId: sessionId },
    );
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.code).toBe("credit_already_redeemed");
    }
  });

  it("rejects redemption when no credit exists", async () => {
    const result = await redeemMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, targetSessionId: sessionId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("credit_not_found");
    }
  });

  it("rejects redemption of an expired credit", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const grant = await grantMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, expiresAt: pastDate },
    );
    expect(grant.kind).toBe("ok");
    const result = await redeemMakeupCredit(
      { tenantId, userId: SYSTEM_USER },
      { memberId, sourceSessionId: sessionId, targetSessionId: sessionId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("credit_expired");
    }
  });
});

// Touch the import the migration's nullability requires —
// the source_session_id is a soft reference (no FK) so the
// only constraint that catches a bad input is the
// source_session_not_found branch.
void asMemberId;
