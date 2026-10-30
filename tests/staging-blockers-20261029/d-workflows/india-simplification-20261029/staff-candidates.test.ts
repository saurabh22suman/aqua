// @vitest-environment node
//
// D-owned staff candidate lookup — real tenant session path
// (requireDefaultCtx -> resolveDefaultMembership -> role permissions) over the
// app-role connection. Only the better-auth and next/headers framework edges are
// stubbed, as in the established role/context tests.
//
// STATUS: IMPLEMENTED — the actual feature RED is management-ui-red.log (the
// missing searchbox / old UUID field); it is not a backend export/import seam.
// A source-level import/type error is still not RED.
//
// Run through the shared lane queue, no timeout around the queue:
//   python3 .opencode/scripts/lane_job.py harness test \
//     tests/staging-blockers-20261029/d-workflows/india-simplification-20261029/staff-candidates.test.ts
//
// Acceptance:
//   * authorized staff.write name/phone search returns only
//     { personId, fullName, phone };
//   * approved location policy: permitted member home locations (R1) plus live
//     tenant-wide staff; no facility-opt-in expansion;
//   * member eligibility requires existing members.read; staff eligibility
//     requires existing staff.read; staff.write is the action gate;
//   * deleted persons and deleted member/staff rows are excluded; cross-tenant
//     persons are invisible; unlocated guardians/enquiries are not candidates;
//   * results are capped at 10 in stable (fullName, id) order;
//   * LIKE wildcards (%, _) are literal, blank/overlong queries are bounded;
//   * anonymous and staff.write-denied callers are refused before any read.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "../../../db/privileged-fixture";

const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (!authUser.betterAuthId) return null;
        return {
          user: { id: authUser.betterAuthId },
          session: { createdAt: new Date() },
        };
      },
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { NotFoundError } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permission";
import { formatPhoneIN } from "@/lib/phone";
import { searchStaffCandidatesAction } from "@/lib/actions/staff";

const RUN = Date.now().toString(36);
const phoneBase = String(Date.now()).slice(-8);
const phone = (n: number) =>
  `+9198${phoneBase}${String(n).padStart(2, "0")}`;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locationA1 = uuidv7();
const locationA2 = uuidv7();
const locationB = uuidv7();

const ownerAId = asUserId(uuidv7());
const coachAId = asUserId(uuidv7());
const ownerBId = asUserId(uuidv7());
const membersOnlyId = asUserId(uuidv7());
const staffReadOnlyId = asUserId(uuidv7());
const writeOnlyId = asUserId(uuidv7());
const zeroLocOwnerId = asUserId(uuidv7());
const allLocOwnerId = asUserId(uuidv7());
const ownerABa = `staff-cand-owner-a-${RUN}`;
const coachABa = `staff-cand-coach-a-${RUN}`;
const ownerBBa = `staff-cand-owner-b-${RUN}`;
const membersOnlyBa = `staff-cand-members-${RUN}`;
const staffReadOnlyBa = `staff-cand-staff-read-${RUN}`;
const writeOnlyBa = `staff-cand-write-only-${RUN}`;
const zeroLocOwnerBa = `staff-cand-zero-loc-${RUN}`;
const allLocOwnerBa = `staff-cand-all-loc-${RUN}`;
const ownerAMembership = uuidv7();
const membersOnlyMembership = uuidv7();
const staffReadOnlyMembership = uuidv7();
const writeOnlyMembership = uuidv7();
const zeroLocMembership = uuidv7();
const allLocMembership = uuidv7();

const person = {
  member: uuidv7(),
  staff: uuidv7(),
  both: uuidv7(),
  minor: uuidv7(),
  noPhone: uuidv7(),
  deleted: uuidv7(),
  otherLocation: uuidv7(),
  percentLiteral: uuidv7(),
  percentWildcard: uuidv7(),
  underscoreLiteral: uuidv7(),
  underscoreWildcard: uuidv7(),
  phoneTarget: uuidv7(),
  crossTenant: uuidv7(),
  nonMember: uuidv7(),
  guardianOnly: uuidv7(),
  deletedMember: uuidv7(),
  deletedStaff: uuidv7(),
  bothLocations: uuidv7(),
  optInOnly: uuidv7(),
  memberWithDeletedStaff: uuidv7(),
  multiStaff: uuidv7(),
  staffOtherMember: uuidv7(),
  formattedPhone: uuidv7(),
  legacySpaced: uuidv7(),
};
const capIds = Array.from({ length: 12 }, () => uuidv7());

const name = {
  member: `Member ${RUN} Aarav`,
  staff: `Staff ${RUN} Meera`,
  both: `Both ${RUN} MemberStaff`,
  minor: `Minor ${RUN} Kabir`,
  noPhone: `NoPhone ${RUN}`,
  deleted: `Deleted ${RUN}`,
  otherLocation: `OtherLocation ${RUN}`,
  percentLiteral: `Percent% ${RUN}`,
  percentWildcard: `PercentX ${RUN}`,
  underscoreLiteral: `Under_score ${RUN}`,
  underscoreWildcard: `UnderXscore ${RUN}`,
  phoneTarget: `PhoneTarget ${RUN}`,
  crossTenant: `CrossTenant ${RUN} Bina`,
  nonMember: `NonMember ${RUN}`,
  guardianOnly: `GuardianOnly ${RUN}`,
  deletedMember: `DeletedMember ${RUN}`,
  deletedStaff: `DeletedStaffOnly ${RUN}`,
  bothLocations: `BothLocations ${RUN}`,
  optInOnly: `OptInOnly ${RUN}`,
  memberWithDeletedStaff: `MemberDeletedStaff ${RUN}`,
  multiStaff: `MultiStaff ${RUN}`,
  staffOtherMember: `StaffOtherMember ${RUN}`,
  formattedPhone: `FormattedPhone ${RUN}`,
  legacySpaced: `LegacySpaced ${RUN}`,
  cap: `Cap ${RUN} Same`,
};

async function roleId(tenantId: TenantId, key: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 and key = $2",
    [tenantId, key],
  );
  if (!rows[0]) throw new Error(`missing ${key} role for ${tenantId}`);
  return rows[0].id;
}

async function createCustomRole(
  tenantId: TenantId,
  key: string,
  permissionKeys: string[],
): Promise<string> {
  const id = uuidv7();
  await admin.query(
    "insert into roles (id, tenant_id, key, name) values ($1, $2, $3, $4)",
    [id, tenantId, key, key],
  );
  for (const permissionKey of permissionKeys) {
    await admin.query(
      `insert into role_permissions (tenant_id, role_id, permission_key)
       values ($1, $2, $3)`,
      [tenantId, id, permissionKey],
    );
  }
  return id;
}

async function insertMembership(
  membershipId: string,
  tenantId: TenantId,
  userId: string,
  roleIdValue: string,
  allLocations: boolean,
): Promise<void> {
  await admin.query(
    `insert into tenant_memberships
       (id, tenant_id, user_id, role_id, all_locations, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    [membershipId, tenantId, userId, roleIdValue, allLocations],
  );
}

async function insertPerson(input: {
  id: string;
  tenantId: TenantId;
  fullName: string;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  medicalNotes?: string | null;
  deletedAt?: Date | null;
}): Promise<void> {
  await admin.query(
    `insert into persons
       (id, tenant_id, full_name, phone, date_of_birth, medical_notes, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.tenantId,
      input.fullName,
      input.phoneNumber ?? null,
      input.dateOfBirth ?? null,
      input.medicalNotes ?? null,
      input.deletedAt ?? null,
    ],
  );
}

async function insertMember(
  tenantId: TenantId,
  personId: string,
  locationId: string,
  memberCode: string,
  deletedAt: Date | null = null,
): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into members
       (id, tenant_id, person_id, location_id, member_code, status, deleted_at)
     values ($1, $2, $3, $4, $5, 'active', $6)`,
    [id, tenantId, personId, locationId, memberCode, deletedAt],
  );
  return id;
}

async function insertStaff(
  tenantId: TenantId,
  personId: string,
  staffType = "coach",
  deletedAt: Date | null = null,
): Promise<void> {
  await admin.query(
    `insert into staff
       (id, tenant_id, person_id, staff_type, deleted_at)
     values ($1, $2, $3, $4, $5)`,
    [uuidv7(), tenantId, personId, staffType, deletedAt],
  );
}

function signInAs(betterAuthId: string): void {
  authUser.betterAuthId = betterAuthId;
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, plan_id) values
       ($1, $2, 'Staff Candidates A', 'active', (select id from plans where key = 'standard')),
       ($3, $4, 'Staff Candidates B', 'active', (select id from plans where key = 'standard'))`,
    [tenantA, `staff-candidates-a-${RUN}`, tenantB, `staff-candidates-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, kind, is_primary) values
       ($1, $2, 'A Main', 'club', true),
       ($3, $2, 'A Other', 'club', false),
       ($4, $5, 'B Main', 'club', true)`,
    [locationA1, tenantA, locationA2, locationB, tenantB],
  );
  await seedRoleTemplates(tenantA);
  await seedRoleTemplates(tenantB);

  const ownerARole = await roleId(tenantA, "owner");
  const coachARole = await roleId(tenantA, "coach");
  const ownerBRole = await roleId(tenantB, "owner");
  const membersOnlyRole = await createCustomRole(
    tenantA,
    `candidates_members_${RUN}`,
    ["staff.write", "members.read"],
  );
  const staffReadOnlyRole = await createCustomRole(
    tenantA,
    `candidates_staff_read_${RUN}`,
    ["staff.write", "staff.read"],
  );
  const writeOnlyRole = await createCustomRole(
    tenantA,
    `candidates_write_only_${RUN}`,
    ["staff.write"],
  );

  for (const [id, phoneNumber, betterAuthId] of [
    [ownerAId, phone(1), ownerABa],
    [coachAId, phone(2), coachABa],
    [ownerBId, phone(3), ownerBBa],
    [membersOnlyId, phone(4), membersOnlyBa],
    [staffReadOnlyId, phone(5), staffReadOnlyBa],
    [writeOnlyId, phone(6), writeOnlyBa],
    [zeroLocOwnerId, phone(7), zeroLocOwnerBa],
    [allLocOwnerId, phone(8), allLocOwnerBa],
  ] as const) {
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [id, phoneNumber, betterAuthId],
    );
  }

  await insertMembership(ownerAMembership, tenantA, ownerAId, ownerARole, false);
  await admin.query(
    `insert into membership_locations
       (id, tenant_id, membership_id, location_id)
     values ($1, $2, $3, $4)`,
    [uuidv7(), tenantA, ownerAMembership, locationA1],
  );
  await insertMembership(uuidv7(), tenantA, coachAId, coachARole, true);
  await insertMembership(uuidv7(), tenantB, ownerBId, ownerBRole, true);
  await insertMembership(
    membersOnlyMembership,
    tenantA,
    membersOnlyId,
    membersOnlyRole,
    false,
  );
  await insertMembership(
    staffReadOnlyMembership,
    tenantA,
    staffReadOnlyId,
    staffReadOnlyRole,
    false,
  );
  await insertMembership(
    writeOnlyMembership,
    tenantA,
    writeOnlyId,
    writeOnlyRole,
    false,
  );
  await insertMembership(
    zeroLocMembership,
    tenantA,
    zeroLocOwnerId,
    ownerARole,
    false,
  );
  await insertMembership(
    allLocMembership,
    tenantA,
    allLocOwnerId,
    ownerARole,
    true,
  );
  for (const membershipId of [
    membersOnlyMembership,
    staffReadOnlyMembership,
    writeOnlyMembership,
  ]) {
    await admin.query(
      `insert into membership_locations
         (id, tenant_id, membership_id, location_id)
       values ($1, $2, $3, $4)`,
      [uuidv7(), tenantA, membershipId, locationA1],
    );
  }

  await insertPerson({
    id: person.member,
    tenantId: tenantA,
    fullName: name.member,
    phoneNumber: phone(10),
  });
  await insertMember(tenantA, person.member, locationA1, `MEM-${RUN}-1`);

  await insertPerson({
    id: person.staff,
    tenantId: tenantA,
    fullName: name.staff,
    phoneNumber: phone(11),
  });
  await insertStaff(tenantA, person.staff, "coach");

  await insertPerson({
    id: person.both,
    tenantId: tenantA,
    fullName: name.both,
    phoneNumber: phone(12),
  });
  await insertMember(tenantA, person.both, locationA1, `MEM-${RUN}-2`);
  await insertStaff(tenantA, person.both, "receptionist");

  await insertPerson({
    id: person.minor,
    tenantId: tenantA,
    fullName: name.minor,
    phoneNumber: phone(13),
    dateOfBirth: "2015-01-01",
    medicalNotes: "minor medical must not leak",
  });
  await insertMember(tenantA, person.minor, locationA1, `MEM-${RUN}-3`);
  await admin.query(
    `insert into guardianships
       (id, tenant_id, minor_id, guardian_id, relationship, is_primary)
     values ($1, $2, $3, $4, 'parent', true)`,
    [uuidv7(), tenantA, person.minor, person.member],
  );

  await insertPerson({
    id: person.noPhone,
    tenantId: tenantA,
    fullName: name.noPhone,
    phoneNumber: null,
  });
  await insertMember(tenantA, person.noPhone, locationA1, `MEM-${RUN}-5`);
  await insertPerson({
    id: person.deleted,
    tenantId: tenantA,
    fullName: name.deleted,
    phoneNumber: phone(14),
    deletedAt: new Date(),
  });
  await insertMember(tenantA, person.deleted, locationA1, `MEM-${RUN}-15`);
  await insertStaff(tenantA, person.deleted, "coach");
  await insertPerson({
    id: person.otherLocation,
    tenantId: tenantA,
    fullName: name.otherLocation,
    phoneNumber: phone(15),
  });
  await insertMember(tenantA, person.otherLocation, locationA2, `MEM-${RUN}-4`);

  await insertPerson({
    id: person.percentLiteral,
    tenantId: tenantA,
    fullName: name.percentLiteral,
    phoneNumber: phone(16),
  });
  await insertMember(tenantA, person.percentLiteral, locationA1, `MEM-${RUN}-7`);
  await insertPerson({
    id: person.percentWildcard,
    tenantId: tenantA,
    fullName: name.percentWildcard,
    phoneNumber: phone(17),
  });
  await insertMember(tenantA, person.percentWildcard, locationA1, `MEM-${RUN}-8`);
  await insertPerson({
    id: person.underscoreLiteral,
    tenantId: tenantA,
    fullName: name.underscoreLiteral,
    phoneNumber: phone(18),
  });
  await insertMember(tenantA, person.underscoreLiteral, locationA1, `MEM-${RUN}-9`);
  await insertPerson({
    id: person.underscoreWildcard,
    tenantId: tenantA,
    fullName: name.underscoreWildcard,
    phoneNumber: phone(19),
  });
  await insertMember(tenantA, person.underscoreWildcard, locationA1, `MEM-${RUN}-10`);
  await insertPerson({
    id: person.phoneTarget,
    tenantId: tenantA,
    fullName: name.phoneTarget,
    phoneNumber: phone(30),
  });
  await insertMember(tenantA, person.phoneTarget, locationA1, `MEM-${RUN}-6`);
  await insertPerson({
    id: person.crossTenant,
    tenantId: tenantB,
    fullName: name.crossTenant,
    phoneNumber: phone(40),
  });
  await insertMember(tenantB, person.crossTenant, locationB, `MEM-${RUN}-B1`);
  await insertPerson({
    id: person.nonMember,
    tenantId: tenantA,
    fullName: name.nonMember,
    phoneNumber: phone(41),
  });
  await insertPerson({
    id: person.guardianOnly,
    tenantId: tenantA,
    fullName: name.guardianOnly,
    phoneNumber: phone(42),
  });
  await admin.query(
    `insert into guardianships
       (id, tenant_id, minor_id, guardian_id, relationship, is_primary)
     values ($1, $2, $3, $4, 'guardian', false)`,
    [uuidv7(), tenantA, person.minor, person.guardianOnly],
  );

  await insertPerson({
    id: person.deletedMember,
    tenantId: tenantA,
    fullName: name.deletedMember,
    phoneNumber: phone(43),
  });
  await insertMember(
    tenantA,
    person.deletedMember,
    locationA1,
    `MEM-${RUN}-16`,
    new Date(),
  );

  await insertPerson({
    id: person.deletedStaff,
    tenantId: tenantA,
    fullName: name.deletedStaff,
    phoneNumber: phone(44),
  });
  await insertStaff(tenantA, person.deletedStaff, "coach", new Date());

  await insertPerson({
    id: person.bothLocations,
    tenantId: tenantA,
    fullName: name.bothLocations,
    phoneNumber: phone(45),
  });
  await insertMember(tenantA, person.bothLocations, locationA1, `MEM-${RUN}-11`);
  await insertMember(tenantA, person.bothLocations, locationA2, `MEM-${RUN}-12`);

  await insertPerson({
    id: person.optInOnly,
    tenantId: tenantA,
    fullName: name.optInOnly,
    phoneNumber: phone(46),
  });
  const optInMemberId = await insertMember(
    tenantA,
    person.optInOnly,
    locationA2,
    `MEM-${RUN}-13`,
  );
  await admin.query(
    `insert into member_facility_optins
       (id, tenant_id, member_id, location_id, opted_on)
     values ($1, $2, $3, $4, current_date)`,
    [uuidv7(), tenantA, optInMemberId, locationA1],
  );

  await insertPerson({
    id: person.memberWithDeletedStaff,
    tenantId: tenantA,
    fullName: name.memberWithDeletedStaff,
    phoneNumber: phone(47),
  });
  await insertMember(
    tenantA,
    person.memberWithDeletedStaff,
    locationA1,
    `MEM-${RUN}-14`,
  );
  await insertStaff(
    tenantA,
    person.memberWithDeletedStaff,
    "coach",
    new Date(),
  );

  await insertPerson({
    id: person.multiStaff,
    tenantId: tenantA,
    fullName: name.multiStaff,
    phoneNumber: phone(48),
  });
  await insertStaff(tenantA, person.multiStaff, "coach");
  await insertStaff(tenantA, person.multiStaff, "receptionist");

  await insertPerson({
    id: person.staffOtherMember,
    tenantId: tenantA,
    fullName: name.staffOtherMember,
    phoneNumber: phone(49),
  });
  await insertStaff(tenantA, person.staffOtherMember, "coach");
  await insertMember(
    tenantA,
    person.staffOtherMember,
    locationA2,
    `MEM-${RUN}-17`,
  );

  await insertPerson({
    id: person.formattedPhone,
    tenantId: tenantA,
    fullName: name.formattedPhone,
    phoneNumber: "+919000000101",
  });
  await insertMember(tenantA, person.formattedPhone, locationA1, `MEM-${RUN}-18`);

  await insertPerson({
    id: person.legacySpaced,
    tenantId: tenantA,
    fullName: name.legacySpaced,
    phoneNumber: "90000 00102",
  });
  await insertMember(tenantA, person.legacySpaced, locationA1, `MEM-${RUN}-19`);

  for (let i = 0; i < capIds.length; i++) {
    await insertPerson({
      id: capIds[i]!,
      tenantId: tenantA,
      fullName: name.cap,
      phoneNumber: phone(100 + i),
    });
    await insertMember(tenantA, capIds[i]!, locationA1, `MEM-${RUN}-cap-${i}`);
  }
}, 120_000);

afterAll(async () => {
  const tenants = [tenantA, tenantB];
  try {
    await admin.query(
      "delete from guardianships where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from member_facility_optins where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from staff where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from members where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from membership_locations where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from tenant_memberships where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from role_permissions where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from roles where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from persons where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from locations where tenant_id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from tenants where id = any($1::uuid[])",
      [tenants],
    );
    await admin.query(
      "delete from users where id = any($1::uuid[])",
      [[
        ownerAId,
        coachAId,
        ownerBId,
        membersOnlyId,
        staffReadOnlyId,
        writeOnlyId,
        zeroLocOwnerId,
        allLocOwnerId,
      ]],
    );
  } finally {
    await admin.end();
  }
}, 120_000);

function expectMinimalProjection(row: unknown): void {
  expect(Object.keys(row as Record<string, unknown>).sort()).toEqual([
    "fullName",
    "personId",
    "phone",
  ]);
}

describe("staff candidate lookup — real tenant session path", () => {
  it("authorized owner finds by name and receives only personId/fullName/phone", async () => {
    signInAs(ownerABa);
    const rows = await searchStaffCandidatesAction(name.member);
    expect(rows).toEqual([
      {
        personId: person.member,
        fullName: name.member,
        phone: phone(10),
      },
    ]);
    expectMinimalProjection(rows[0]);
  });

  it("authorized owner finds by phone and returns a null phone honestly", async () => {
    signInAs(ownerABa);
    const byPhone = await searchStaffCandidatesAction(phone(30));
    expect(byPhone).toEqual([
      {
        personId: person.phoneTarget,
        fullName: name.phoneTarget,
        phone: phone(30),
      },
    ]);

    const noPhone = await searchStaffCandidatesAction(name.noPhone);
    expect(noPhone).toEqual([
      { personId: person.noPhone, fullName: name.noPhone, phone: null },
    ]);
  });

  it("matches a formatted +91/spaced phone to a canonical permitted person", async () => {
    signInAs(ownerABa);
    const formatted = formatPhoneIN("+919000000101");
    expect(formatted).toBe("+91 90000 00101");
    const rows = await searchStaffCandidatesAction(formatted);
    expect(rows).toEqual([
      {
        personId: person.formattedPhone,
        fullName: name.formattedPhone,
        phone: "+919000000101",
      },
    ]);
  });

  it("matches canonical digits to a permitted legacy spaced phone", async () => {
    signInAs(ownerABa);
    const rows = await searchStaffCandidatesAction("9000000102");
    expect(rows).toEqual([
      {
        personId: person.legacySpaced,
        fullName: name.legacySpaced,
        phone: "90000 00102",
      },
    ]);
  });

  it("includes members, staff, a member+staff person and a minor", async () => {
    signInAs(ownerABa);
    for (const [personId, fullName] of [
      [person.member, name.member],
      [person.staff, name.staff],
      [person.both, name.both],
      [person.minor, name.minor],
    ] as const) {
      const rows = await searchStaffCandidatesAction(fullName);
      expect(rows.map((row) => row.personId)).toContain(personId);
      if (personId === person.both) {
        expect(rows.filter((row) => row.personId === personId)).toHaveLength(1);
      }
    }
  });

  it("never returns DOB, medical, guardian, member or auth identifiers", async () => {
    signInAs(ownerABa);
    const rows = await searchStaffCandidatesAction(name.minor);
    expect(rows).toHaveLength(1);
    expectMinimalProjection(rows[0]);
    const payload = JSON.stringify(rows);
    expect(payload).not.toContain("2015-01-01");
    expect(payload).not.toContain("minor medical");
    expect(payload).not.toContain("guardian");
    expect(payload).not.toContain("memberCode");
    expect(payload).not.toContain("betterAuthId");
  });

  it("excludes a soft-deleted person", async () => {
    signInAs(ownerABa);
    await expect(searchStaffCandidatesAction(name.deleted)).resolves.toEqual([]);
  });

  it("isolates tenants in both directions", async () => {
    signInAs(ownerABa);
    await expect(
      searchStaffCandidatesAction(name.crossTenant),
    ).resolves.toEqual([]);

    signInAs(ownerBBa);
    await expect(searchStaffCandidatesAction(name.member)).resolves.toEqual([]);
    const ownTenant = await searchStaffCandidatesAction(name.crossTenant);
    expect(ownTenant.map((row) => row.personId)).toEqual([person.crossTenant]);
  });

  it("denies a coach without staff.write through the real permission path", async () => {
    signInAs(coachABa);
    await expect(searchStaffCandidatesAction(name.member)).rejects.toMatchObject({
      name: "ForbiddenError",
      permissionKey: "staff.write",
    });
    await expect(searchStaffCandidatesAction(name.member)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("denies an anonymous caller with the real session 404", async () => {
    signInAs("");
    await expect(searchStaffCandidatesAction(name.member)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("bounds blank and overlong queries without throwing", async () => {
    signInAs(ownerABa);
    await expect(searchStaffCandidatesAction("")).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction("   ")).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction("x".repeat(201))).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction("x".repeat(200))).resolves.toEqual([]);
  });

  it("treats % and _ as literal characters, not LIKE wildcards", async () => {
    signInAs(ownerABa);
    const percent = await searchStaffCandidatesAction(`Percent% ${RUN}`);
    expect(percent.map((row) => row.personId)).toEqual([person.percentLiteral]);

    const underscore = await searchStaffCandidatesAction(`Under_score ${RUN}`);
    expect(underscore.map((row) => row.personId)).toEqual([
      person.underscoreLiteral,
    ]);
  });

  it("caps at 10 and orders equal names by id", async () => {
    signInAs(ownerABa);
    const rows = await searchStaffCandidatesAction(name.cap);
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.personId)).toEqual(
      [...capIds].sort().slice(0, 10),
    );
  });

  it("restricts a location-limited owner to permitted member home locations", async () => {
    signInAs(ownerABa);

    const permitted = await searchStaffCandidatesAction(name.member);
    expect(permitted.map((row) => row.personId)).toEqual([person.member]);

    const other = await searchStaffCandidatesAction(name.otherLocation);
    expect(other).toEqual([]);

    const multi = await searchStaffCandidatesAction(name.bothLocations);
    expect(multi.map((row) => row.personId)).toEqual([person.bothLocations]);
    expect(multi).toHaveLength(1);

    // R1 home-location policy: an opt-in at A does not make a B-home member
    // eligible for an A-limited caller.
    const optIn = await searchStaffCandidatesAction(name.optInOnly);
    expect(optIn).toEqual([]);
  });

  it("includes live tenant staff tenant-wide and dedupes both-path persons", async () => {
    signInAs(ownerABa);
    const staffRows = await searchStaffCandidatesAction(name.staff);
    expect(staffRows.map((row) => row.personId)).toEqual([person.staff]);

    const bothRows = await searchStaffCandidatesAction(name.both);
    expect(bothRows.map((row) => row.personId)).toEqual([person.both]);
    expect(bothRows).toHaveLength(1);

    const multiStaff = await searchStaffCandidatesAction(name.multiStaff);
    expect(multiStaff.map((row) => row.personId)).toEqual([person.multiStaff]);
    expect(multiStaff).toHaveLength(1);

    // Staff eligibility is tenant-wide; the person's member home location is B,
    // which is outside owner A's permitted location.
    const staffOtherMember = await searchStaffCandidatesAction(
      name.staffOtherMember,
    );
    expect(staffOtherMember.map((row) => row.personId)).toEqual([
      person.staffOtherMember,
    ]);
  });

  it("lets allLocations include every live member home location", async () => {
    signInAs(allLocOwnerBa);

    const other = await searchStaffCandidatesAction(name.otherLocation);
    expect(other.map((row) => row.personId)).toEqual([person.otherLocation]);

    const optInOnly = await searchStaffCandidatesAction(name.optInOnly);
    expect(optInOnly.map((row) => row.personId)).toEqual([person.optInOnly]);

    const multi = await searchStaffCandidatesAction(name.bothLocations);
    expect(multi).toHaveLength(1);

    // All locations does not turn unlocated guardians/enquiries into candidates.
    await expect(searchStaffCandidatesAction(name.nonMember)).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction(name.guardianOnly)).resolves.toEqual(
      [],
    );
  });

  it("treats zero permitted locations as authorized staff-only", async () => {
    signInAs(zeroLocOwnerBa);
    await expect(searchStaffCandidatesAction(name.member)).resolves.toEqual([]);
    const staffRows = await searchStaffCandidatesAction(name.staff);
    expect(staffRows.map((row) => row.personId)).toEqual([person.staff]);
    await expect(searchStaffCandidatesAction(name.nonMember)).resolves.toEqual([]);
  });

  it("requires the existing members.read right for member eligibility", async () => {
    signInAs(membersOnlyBa);
    const member = await searchStaffCandidatesAction(name.member);
    expect(member.map((row) => row.personId)).toEqual([person.member]);
    await expect(searchStaffCandidatesAction(name.staff)).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction(name.otherLocation)).resolves.toEqual(
      [],
    );
  });

  it("requires the existing staff.read right for staff eligibility", async () => {
    signInAs(staffReadOnlyBa);
    const staffRows = await searchStaffCandidatesAction(name.staff);
    expect(staffRows.map((row) => row.personId)).toEqual([person.staff]);
    await expect(searchStaffCandidatesAction(name.member)).resolves.toEqual([]);
  });

  it("returns no candidates for staff.write without either read right", async () => {
    signInAs(writeOnlyBa);
    await expect(searchStaffCandidatesAction(name.member)).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction(name.staff)).resolves.toEqual([]);
  });

  it("excludes deleted member/staff rows and removed persons", async () => {
    signInAs(ownerABa);
    await expect(searchStaffCandidatesAction(name.deletedMember)).resolves.toEqual(
      [],
    );
    await expect(searchStaffCandidatesAction(name.deletedStaff)).resolves.toEqual(
      [],
    );
    // The person row is removed even though it has a live member and staff row.
    await expect(searchStaffCandidatesAction(name.deleted)).resolves.toEqual([]);
  });

  it("keeps a live member visible when only the staff row is deleted", async () => {
    signInAs(ownerABa);
    const rows = await searchStaffCandidatesAction(name.memberWithDeletedStaff);
    expect(rows.map((row) => row.personId)).toEqual([
      person.memberWithDeletedStaff,
    ]);
  });

  it("does not include unlocated guardians or enquiries", async () => {
    signInAs(ownerABa);
    await expect(searchStaffCandidatesAction(name.nonMember)).resolves.toEqual([]);
    await expect(searchStaffCandidatesAction(name.guardianOnly)).resolves.toEqual(
      [],
    );
  });
});
