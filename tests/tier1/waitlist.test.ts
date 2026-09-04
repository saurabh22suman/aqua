import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, members, batches } from "@/db/schema";
import { enrolments } from "@/db/schema/scheduling";
import { waitlistEntries } from "@/db/schema/waitlist-entries";
import {
  addToWaitlist,
  cancelWaitlist,
  getWaitlistHead,
  promoteHead,
} from "@/lib/services/waitlist";
import { asTenantId, asUserId, asMemberId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";
let memberAId = "";
let memberBId = "";
let batchId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Waitlist Test', $3)",
    [tenantId, "waitlist-" + RUN, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Waitlist Program" })
      .returning({ id: programs.id });
    programId = prog!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(waitlistEntries).where(eq(waitlistEntries.tenantId, tenantId));
      await tx.delete(enrolments).where(eq(enrolments.tenantId, tenantId));
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
    await tx.delete(waitlistEntries).where(eq(waitlistEntries.tenantId, tenantId));
    await tx.delete(enrolments).where(eq(enrolments.tenantId, tenantId));
    await tx.delete(members).where(eq(members.tenantId, tenantId));
    await tx.delete(batches).where(eq(batches.tenantId, tenantId));
  });

  await withTenant(tenantId, async (tx) => {
    const [p1] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Member A", dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [m1] = await tx
      .insert(members)
      .values({
        tenantId,
        personId: p1!.id,
        locationId,
        memberCode: "WL-A-" + RUN + "-" + p1!.id.slice(0, 4).replace(/-/g, ""),
        status: "active",
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      })
      .returning({ id: members.id });
    memberAId = m1!.id;

    const [p2] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Member B", dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [m2] = await tx
      .insert(members)
      .values({
        tenantId,
        personId: p2!.id,
        locationId,
        memberCode: "WL-B-" + RUN + "-" + p2!.id.slice(0, 4).replace(/-/g, ""),
        status: "active",
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      })
      .returning({ id: members.id });
    memberBId = m2!.id;

    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Full Batch",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    batchId = b!.id;
  });
});

describe("addToWaitlist (Phase R.5)", () => {
  it("places the first entry at position 1", async () => {
    const result = await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.position).toBe(1);
    }
  });

  it("places the second entry at position 2 (FIFO)", async () => {
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    const second = await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberBId, batchId },
    );
    expect(second.kind).toBe("ok");
    if (second.kind === "ok") {
      expect(second.position).toBe(2);
    }
  });

  it("rejects a second add for the same member (open-waitlist unique)", async () => {
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    const second = await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.code).toBe("already_on_waitlist");
    }
  });

  it("rejects adding a member already enrolled in the batch", async () => {
    await withTenant(tenantId, async (tx) => {
      await tx.insert(enrolments).values({
        tenantId,
        memberId: asMemberId(memberAId),
        batchId,
        enrolledOn: new Date().toISOString().slice(0, 10),
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      });
    });
    const result = await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("already_on_waitlist");
    }
  });
});

describe("promoteHead + re-indexing (Phase R.5)", () => {
  it("promotes the head and re-indexes the remaining queue", async () => {
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberBId, batchId },
    );
    const promote = await promoteHead(
      { tenantId, userId: SYSTEM_USER },
      { batchId },
    );
    expect(promote.kind).toBe("ok");

    // Head is now member B; his position is the one member A
    // previously held (i.e. 1 after the re-index).
    const head = await getWaitlistHead(
      { tenantId, userId: SYSTEM_USER },
      { batchId },
    );
    expect(head).toBeDefined();
    expect(head!.memberId).toBe(memberBId);
    expect(head!.position).toBe(1);
  });

  it("returns not_on_waitlist when the queue is empty", async () => {
    const result = await promoteHead(
      { tenantId, userId: SYSTEM_USER },
      { batchId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("not_on_waitlist");
    }
  });
});

describe("cancelWaitlist + re-indexing (Phase R.5)", () => {
  it("cancels a middle position and shifts the rest down", async () => {
    // 3 entries: A(1), B(2), C(3). Cancel B. C should move to 2.
    const cMemberId = await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Member C", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [m] = await tx
        .insert(members)
        .values({
          tenantId,
          personId: p!.id,
          locationId,
          memberCode: "WL-C-" + RUN + "-" + p!.id.slice(0, 4).replace(/-/g, ""),
          status: "active",
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        })
        .returning({ id: members.id });
      return m!.id;
    });

    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberAId, batchId },
    );
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberBId, batchId },
    );
    await addToWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: cMemberId, batchId },
    );

    const cancel = await cancelWaitlist(
      { tenantId, userId: SYSTEM_USER },
      { memberId: memberBId, batchId },
    );
    expect(cancel.kind).toBe("ok");

    const head = await getWaitlistHead(
      { tenantId, userId: SYSTEM_USER },
      { batchId },
    );
    // After the cancel, the queue is A(1) + C(2). Head is A.
    expect(head).toBeDefined();
    expect(head!.memberId).toBe(memberAId);
    expect(head!.position).toBe(1);
  });
});
