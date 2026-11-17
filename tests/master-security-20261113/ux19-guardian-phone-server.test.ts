import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";

const state = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/context", async (original) => ({ ...(await original<typeof import("@/lib/auth/context")>()), requireDefaultCtx: state.ctx }));
import { createMemberAction } from "@/lib/actions/people";
import { bookTrialAction, createEnquiryAction } from "@/lib/actions/enquiries";
import { bookTrialSchema, createEnquirySchema, guardianInputSchema } from "@/lib/schemas";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'enquiries.write')", [f.tenantId, f.roleId]);
  state.ctx.mockResolvedValue({ ...f.context(), permissions: new Set(["members.write", "enquiries.write"]), features: new Set(["members", "enquiries"]) });
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from enquiries where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from consents where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

const guardian = { fullName: "Synthetic Guardian", relationship: "parent" };
it.each(["letters", "+91+91 9876543210", "+0123456789", "98765.43210", "+919876543210123456789"]) (
  "rejects invalid new-guardian phone %s at the real create action before any writes", async (phone) => {
    const count = async () => (await f.admin.query(
      `select (select count(*)::int from persons where tenant_id=$1) persons,
              (select count(*)::int from members where tenant_id=$1) members,
              (select count(*)::int from guardianships where tenant_id=$1) guardianships,
              (select count(*)::int from consents where tenant_id=$1) consents,
              (select count(*)::int from audit_log where tenant_id=$1) audits`, [f.tenantId],
    )).rows[0];
    const before = await count();
    await expect(createMemberAction({ fullName: "Synthetic Child", dateOfBirth: "2015-01-01", locationId: f.locationA,
      guardian: { ...guardian, phone }, consents: [{ purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } }] })).rejects.toThrow();
    expect(await count()).toEqual(before);
  },
);

it.each([[undefined, undefined], ["", undefined], ["   ", undefined], [" 9876543210 ", "+919876543210"], ["+1 (202) 555-0123", "+12025550123"]] as const)(
  "preserves optional/normalised new guardian phone %j", (input, expected) => {
    expect(guardianInputSchema.parse({ ...guardian, phone: input })).toEqual({ ...guardian, phone: expected });
  },
);

it("retains existing-person guardian identity without requiring a phone", () => {
  expect(guardianInputSchema.parse({ existingPersonId: f.personId, relationship: "parent" })).toEqual({ existingPersonId: f.personId, relationship: "parent" });
});

it.each([["   ", null], [" 9876543210 ", "+919876543210"]] as const)(
  "creates an authorized minor with optional or normalized guardian phone %j and its consent/audit", async (phone, expected) => {
    const result = await createMemberAction({ fullName: "Synthetic Accepted Child", dateOfBirth: "2015-01-01", locationId: f.locationA,
      guardian: { ...guardian, phone }, consents: [{ purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { rows } = await f.admin.query(`select g.phone, c.granted_by, c.person_id, a.actor_id
      from members m join guardianships gs on gs.tenant_id=m.tenant_id and gs.minor_id=m.person_id
      join persons g on g.tenant_id=gs.tenant_id and g.id=gs.guardian_id
      join consents c on c.tenant_id=m.tenant_id and c.person_id=m.person_id
      join audit_log a on a.tenant_id=m.tenant_id and a.entity_id=m.id and a.action='member.create'
      where m.tenant_id=$1 and m.id=$2`, [f.tenantId, result.memberId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone: expected, actor_id: f.userId });
    expect(rows[0].granted_by).not.toBe(rows[0].person_id);
  },
);

it("rejects alphabetic enquiry contact at the real action before storing the enquiry", async () => {
  const before = await f.admin.query("select count(*)::int n from enquiries where tenant_id=$1", [f.tenantId]);
  await expect(createEnquiryAction({ fullName: "Synthetic Enquiry", phone: "abcdefgh", source: "phone", locationId: f.locationA })).rejects.toThrow();
  expect((await f.admin.query("select count(*)::int n from enquiries where tenant_id=$1", [f.tenantId])).rows).toEqual(before.rows);
});

it("rejects alphabetic trial contact before member, consent, enrolment or audit writes", async () => {
  const enquiryId = randomUUID();
  await f.admin.query("insert into enquiries(id,tenant_id,full_name,source,stage,location_id) values($1,$2,'Synthetic trial','phone','new',$3)", [enquiryId, f.tenantId, f.locationA]);
  const counts = async () => (await f.admin.query(`select
    (select count(*)::int from persons where tenant_id=$1) persons,
    (select count(*)::int from members where tenant_id=$1) members,
    (select count(*)::int from consents where tenant_id=$1) consents,
    (select count(*)::int from enrolments where tenant_id=$1) enrolments,
    (select count(*)::int from audit_log where tenant_id=$1) audits`, [f.tenantId])).rows[0];
  const before = await counts();
  await expect(bookTrialAction({ enquiryId, batchId: f.batchA, phone: "abcdefgh", details: {
    dateOfBirth: "1990-01-01", locationId: f.locationA,
    consents: [{ purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } }],
  } })).rejects.toThrow();
  expect(await counts()).toEqual(before);
  expect((await f.admin.query("select stage,member_id from enquiries where id=$1", [enquiryId])).rows).toEqual([{ stage: "new", member_id: null }]);
});

it.each([createEnquirySchema.shape.phone, bookTrialSchema.shape.phone])("treats blank contact as absent and normalises valid input", (schema) => {
  expect(schema.parse(" ")).toBeUndefined();
  expect(schema.parse(" 9876543210 ")).toBe("+919876543210");
  expect(schema.safeParse("+91+91 9876543210").success).toBe(false);
});

it("normalises a valid enquiry and explicit trial contact without changing tenant and consent bindings", async () => {
  const enquiry = await createEnquiryAction({ fullName: "Synthetic valid trial", phone: " 9876543210 ", source: "phone", locationId: f.locationA });
  const created = await bookTrialAction({ enquiryId: enquiry.id, batchId: f.batchA, phone: "+1 (202) 555-0123", details: {
    dateOfBirth: "1990-01-01", locationId: f.locationA,
    consents: [{ purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } }],
  } });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const { rows } = await f.admin.query(`select e.phone as enquiry_phone, p.phone as member_phone, m.tenant_id, c.purpose
    from enquiries e join members m on m.id=e.member_id and m.tenant_id=e.tenant_id
    join persons p on p.id=m.person_id and p.tenant_id=m.tenant_id
    join consents c on c.person_id=p.id and c.tenant_id=p.tenant_id
    where e.id=$1 and e.tenant_id=$2`, [enquiry.id, f.tenantId]);
  expect(rows).toEqual([expect.objectContaining({ enquiry_phone: "+919876543210", member_phone: "+12025550123", tenant_id: f.tenantId, purpose: "processing" })]);
});
