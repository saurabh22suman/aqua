import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs, persons, staff } from "@/db/schema";
import { createMember } from "@/lib/services/register";
import { createBatch } from "@/lib/services/programs";
import { getOnboardingChecklist } from "@/lib/services/onboarding-checklist";
import { asStaffId, asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// Phase 2.8 — onboarding checklist service tests. TDD; the
// implementation arrives in the same PR. The service is the read
// side only: it inspects the tenant's row counts and returns a
// derived checklist. No mutation, no schema change. The page at
// app/(owner)/owner/onboarding consumes it as a server action.
//
// Auth/role gating on the action itself is covered by the
// standing server-action-preamble test; this file exercises the
// computed state across the four interesting combinations
// (none → some → all done) so a future change that, say, dropped
// the batches-with-coach check would fail to slip past this gate.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Onboarding Test', $3, $4)",
    [tenantId, `onboarding-${RUN}`, plan?.id ?? null, TZ],
  );

  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Beginners" })
      .returning({ id: programs.id });
    programId = p!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("getOnboardingChecklist (Phase 2.8)", () => {
  it("lists the three minimal items by default — add members, create a batch, assign a coach", async () => {
    const data = await getOnboardingChecklist({ tenantId });
    expect(data.items.map((i) => i.key)).toEqual([
      "add_members",
      "create_batch",
      "assign_coach",
    ]);
    expect(data.totalCount).toBe(3);
    // Brand new tenant: every item is incomplete.
    expect(data.completedCount).toBe(0);
    expect(data.items.every((i) => i.complete === false)).toBe(true);
  });

  it("marks 'add_members' complete the moment a single non-deleted member exists", async () => {
    await createMember(
      { tenantId, userId: SYSTEM_USER },
      {
        fullName: "First Member",
        dateOfBirth: "1990-01-01",
        locationId,
        memberCode: `OB1-${RUN}`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
        ],
      },
    );

    const data = await getOnboardingChecklist({ tenantId });
    const item = data.items.find((i) => i.key === "add_members");
    expect(item?.complete).toBe(true);
    expect(data.completedCount).toBe(1);
  });

  it("marks 'create_batch' complete when at least one batch exists for the tenant", async () => {
    await createBatch(
      { tenantId, userId: SYSTEM_USER },
      {
        programId,
        name: "Beginners 06:00",
        capacity: 12,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "06:00",
        endTime: "07:00",
      },
    );

    const data = await getOnboardingChecklist({ tenantId });
    const item = data.items.find((i) => i.key === "create_batch");
    expect(item?.complete).toBe(true);
    expect(data.completedCount).toBe(2);
  });

  it("'assign_coach' is incomplete while every batch has a null coach_id", async () => {
    const data = await getOnboardingChecklist({ tenantId });
    const item = data.items.find((i) => i.key === "assign_coach");
    expect(item?.complete).toBe(false);
  });

  it("'assign_coach' completes once any batch carries a coach_id", async () => {
    let coachStaffId = "";
    await withTenant(tenantId, async (tx) => {
      const [personRow] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Coach Rehan", dateOfBirth: "1985-05-12" })
        .returning({ id: persons.id });
      const [staffRow] = await tx
        .insert(staff)
        .values({
          tenantId,
          personId: personRow!.id,
          staffType: "coach",
        })
        .returning({ id: staff.id });
      coachStaffId = staffRow!.id;
      // Find the previously-created batch and assign the coach.
      const [batchRow] = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(and(eq(batches.tenantId, tenantId), eq(batches.name, "Beginners 06:00")))
        .limit(1);
      await tx
        .update(batches)
        .set({ coachId: asStaffId(coachStaffId), updatedBy: SYSTEM_USER })
        .where(eq(batches.id, batchRow!.id));
    });

    const data = await getOnboardingChecklist({ tenantId });
    const item = data.items.find((i) => i.key === "assign_coach");
    expect(item?.complete).toBe(true);
    expect(data.completedCount).toBe(3);
    expect(data.items.every((i) => i.complete === true)).toBe(true);
    void coachStaffId;
  });

  it("every item carries a non-empty title, detail, and CTA — no item is blank for the UI", async () => {
    const data = await getOnboardingChecklist({ tenantId });
    for (const item of data.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.cta.label.length).toBeGreaterThan(0);
      expect(item.cta.href.startsWith("/")).toBe(true);
    }
  });

  it("re-reads after a deletion so the checklist reflects reality, not a cached snapshot", async () => {
    // Re-use the fully-populated tenant, then soft-delete the test
    // member, then verify add_members flips back to incomplete. This
    // catches the otherwise-invisible "computed once at fixture
    // startup" failure mode.
    await admin.query(
      "update members set deleted_at = now() where tenant_id = $1 and member_code = $2",
      [tenantId, `OB1-${RUN}`],
    );
    const data = await getOnboardingChecklist({ tenantId });
    const item = data.items.find((i) => i.key === "add_members");
    expect(item?.complete).toBe(false);
  });
});
