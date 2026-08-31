import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, members, programs } from "@/db/schema";
import {
  addFollowUp,
  bookTrial,
  completeFollowUp,
  conversionRateBySource,
  convertEnquiry,
  createEnquiry,
  getEnquiryDetail,
  listEnquiries,
  listOverdueFollowUps,
  transitionEnquiryStage,
} from "@/lib/services/enquiries";
import { getRosterForSession } from "@/lib/services/register";
import { generateSessions } from "@/lib/jobs/session-generator";

// Non-Tier-1 safety net, same pattern as the other lib/services/*
// test files. Covers C-12 (capture), C-13 (pipeline + follow-ups),
// C-14 (trial booking against a real batch), C-15 (conversion,
// source attribution).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId = "";
let locationId = "";
let batchId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Enquiries', $3, $4)",
    [tenantId, `enquiries-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Enquiries Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
    const [program] = await tx
      .insert(programs)
      .values({ tenantId, name: "Enquiries Program" })
      .returning({ id: programs.id });
    const [batch] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId: program.id,
        name: "Trial Batch",
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    batchId = batch.id;
  });
  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, TZ));
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from enquiry_follow_ups where tenant_id = $1", [tenantId]);
    await admin.query("delete from enquiries where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

function newMemberDetails(dob = "1990-01-01") {
  return {
    dateOfBirth: dob,
    locationId,
    consents: [
      { purpose: "processing" as const, policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
    ],
  };
}

describe("createEnquiry / listEnquiries", () => {
  it("captures a walk-in with just a name and source", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Walk In Subject", source: "walk-in" });
    expect(enquiry.stage).toBe("new");

    const rows = await listEnquiries({ tenantId });
    expect(rows.some((r) => r.id === enquiry.id)).toBe(true);
  });

  it("filters by stage", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Stage Filter Subject", source: "phone" });
    const rows = await listEnquiries({ tenantId }, { stage: "new" });
    expect(rows.some((r) => r.id === enquiry.id)).toBe(true);
    expect(rows.every((r) => r.stage === "new")).toBe(true);
  });
});

describe("transitionEnquiryStage", () => {
  it("moves new -> contacted -> lost", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Pipeline Subject", source: "referral" });
    const step1 = await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "contacted" });
    expect(step1.ok).toBe(true);
    const step2 = await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "lost" });
    expect(step2.ok).toBe(true);

    const detail = await getEnquiryDetail({ tenantId }, enquiry.id);
    expect(detail?.stage).toBe("lost");
  });

  it("rejects a transition not in the allowed graph", async () => {
    // "new" can skip straight to trial_scheduled or converted, but
    // never to trial_completed -- a trial can't be marked complete
    // before it was ever scheduled.
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Bad Transition Subject", source: "online" });
    const result = await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "trial_completed" });
    expect(result.ok).toBe(false);
  });

  it("lost is not terminal -- can reopen to new", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Reopen Subject", source: "other" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "contacted" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "lost" });
    const reopened = await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "new" });
    expect(reopened.ok).toBe(true);
  });
});

describe("follow-ups", () => {
  it("an overdue, incomplete follow-up surfaces in listOverdueFollowUps; completing it removes it", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Follow Up Subject", source: "walk-in" });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const followUp = await addFollowUp({ tenantId }, { enquiryId: enquiry.id, dueAt: past, note: "call back" });

    const overdue = await listOverdueFollowUps({ tenantId });
    expect(overdue.some((f) => f.id === followUp.id)).toBe(true);

    const completed = await completeFollowUp({ tenantId }, followUp.id);
    expect(completed.ok).toBe(true);

    const afterComplete = await listOverdueFollowUps({ tenantId });
    expect(afterComplete.some((f) => f.id === followUp.id)).toBe(false);
  });

  it("a future follow-up does not appear as overdue", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Future Follow Up Subject", source: "walk-in" });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const followUp = await addFollowUp({ tenantId }, { enquiryId: enquiry.id, dueAt: future });

    const overdue = await listOverdueFollowUps({ tenantId });
    expect(overdue.some((f) => f.id === followUp.id)).toBe(false);
  });
});

describe("bookTrial", () => {
  it("creates a trial member, enrols them, and the roster flags them as a trial", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Trial Subject", phone: "9876511111", source: "walk-in" });
    const result = await bookTrial(
      { tenantId },
      { enquiryId: enquiry.id, batchId, details: newMemberDetails() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [member] = await withTenant(tenantId, (tx) => tx.select().from(members).where(eq(members.id, result.memberId)));
    expect(member.status).toBe("trial");

    const detail = await getEnquiryDetail({ tenantId }, enquiry.id);
    expect(detail?.stage).toBe("trial_scheduled");
    expect(detail?.memberId).toBe(result.memberId);

    const sessionRow = await admin.query<{ id: string }>(
      "select id from sessions where tenant_id = $1 and batch_id = $2 order by starts_at limit 1",
      [tenantId, batchId],
    );
    const roster = await getRosterForSession(
      { tenantId, userId: undefined, roleKey: "owner" },
      sessionRow.rows[0].id,
    );
    const trialRow = roster?.rows.find((r) => r.memberId === result.memberId);
    expect(trialRow?.isTrial).toBe(true);
  });

  it("refuses a second trial booking on an enquiry that already has a member", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Double Trial Subject", source: "walk-in" });
    const first = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    expect(first.ok).toBe(true);

    const second = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    expect(second.ok).toBe(false);
  });

  // Isolates the memberId guard specifically from the stage-graph
  // guard: reopening via lost -> new makes the stage check permissive
  // again (new allows trial_scheduled), so only the "already has a
  // member" check stands between this enquiry and a second, orphaned
  // member row.
  it("refuses a second trial booking even after the enquiry reopens from lost", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Reopened Double Trial Subject", source: "walk-in" });
    const first = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    expect(first.ok).toBe(true);

    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "lost" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "new" });

    const second = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    expect(second.ok).toBe(false);
  });

  it("refuses to book a trial from a stage that doesn't allow it", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Lost Trial Subject", source: "walk-in" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "contacted" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "trial_scheduled" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "lost" });

    const result = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    expect(result.ok).toBe(false);
  });
});

describe("convertEnquiry", () => {
  it("converts via a trial: trial -> active on the same member, source preserved", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Convert Via Trial Subject", source: "referral" });
    const trial = await bookTrial({ tenantId }, { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
    if (!trial.ok) throw new Error("fixture failed");
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "trial_completed" });

    const converted = await convertEnquiry({ tenantId }, { enquiryId: enquiry.id, reason: "loved the trial" });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.memberId).toBe(trial.memberId);

    const [member] = await withTenant(tenantId, (tx) => tx.select().from(members).where(eq(members.id, trial.memberId)));
    expect(member.status).toBe("active");

    const detail = await getEnquiryDetail({ tenantId }, enquiry.id);
    expect(detail?.stage).toBe("converted");
  });

  it("converts directly without a trial: creates a new active member", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "Direct Convert Subject", source: "online" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "contacted" });

    const converted = await convertEnquiry(
      { tenantId },
      { enquiryId: enquiry.id, reason: "sibling of existing member", newMember: newMemberDetails() },
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const [member] = await withTenant(tenantId, (tx) => tx.select().from(members).where(eq(members.id, converted.memberId)));
    expect(member.status).toBe("active");
  });

  it("refuses direct conversion without member details when there was no trial", async () => {
    const enquiry = await createEnquiry({ tenantId }, { fullName: "No Details Subject", source: "online" });
    await transitionEnquiryStage({ tenantId }, { enquiryId: enquiry.id, toStage: "contacted" });

    const converted = await convertEnquiry({ tenantId }, { enquiryId: enquiry.id, reason: "no details given" });
    expect(converted.ok).toBe(false);
  });
});

describe("conversionRateBySource", () => {
  it("reports total and converted counts per source", async () => {
    const source = "referral" as const;
    const won = await createEnquiry({ tenantId }, { fullName: "Rate Won Subject", source });
    await transitionEnquiryStage({ tenantId }, { enquiryId: won.id, toStage: "contacted" });
    await convertEnquiry({ tenantId }, { enquiryId: won.id, reason: "converted", newMember: newMemberDetails() });

    const lost = await createEnquiry({ tenantId }, { fullName: "Rate Lost Subject", source });
    await transitionEnquiryStage({ tenantId }, { enquiryId: lost.id, toStage: "lost" });

    const rows = await conversionRateBySource({ tenantId });
    const referralRow = rows.find((r) => r.source === source);
    expect(referralRow).toBeDefined();
    expect(referralRow!.total).toBeGreaterThanOrEqual(2);
    expect(referralRow!.converted).toBeGreaterThanOrEqual(1);
    expect(referralRow!.ratePct).toBeGreaterThan(0);
  });
});
