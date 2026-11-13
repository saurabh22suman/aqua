import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { searchStaffCandidates } from "@/lib/services/staff-candidates";

let f: Awaited<ReturnType<typeof fixture>>;
const otherPerson = randomUUID();
const otherMember = randomUUID();
const staffPerson = randomUUID();
const staffId = randomUUID();

beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update persons set full_name='Candidate Within' where id=$1", [f.personId]);
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$3,'Candidate Outside'),($2,$3,'Candidate Staff')", [otherPerson, staffPerson, f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','CANDIDATE-B')", [otherMember, f.tenantId, otherPerson, f.locationB]);
  await f.admin.query("insert into staff(id,tenant_id,person_id,staff_type) values($1,$2,$3,'coach')", [staffId, f.tenantId, staffPerson]);
});

afterAll(async () => { await f.cleanup(); });

describe("staff candidate live authority", () => {
  it("intersects forged all-location claims with the manager's live location", async () => {
    const ctx = { ...f.context(f.managerId, "manager"), allLocations: true, locationIds: [f.locationA, f.locationB] };
    const rows = await searchStaffCandidates(ctx, "Candidate");
    expect(rows.map(row => row.personId)).toEqual([f.personId]);
  });

  it("keeps a custom restricted role scoped with the legacy switch off", async () => {
    await f.admin.query("update roles set key='candidate_custom' where id=(select role_id from tenant_memberships where id=$1)", [f.managerMembership]);
    try {
      const ctx = { ...f.context(f.managerId, "manager"), allLocations: true, locationIds: [f.locationA, f.locationB] };
      expect((await searchStaffCandidates(ctx, "Candidate")).map(row => row.personId)).toEqual([f.personId]);
    } finally {
      await f.admin.query("update roles set key='manager' where id=(select role_id from tenant_memberships where id=$1)", [f.managerMembership]);
    }
  });

  it("denies a revoked membership even when the context still claims read grants", async () => {
    await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
    try {
      expect(await searchStaffCandidates(f.context(f.managerId, "manager"), "Candidate")).toEqual([]);
    } finally {
      await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]);
    }
  });

  it("does not revive a removed member grant from a stale context", async () => {
    await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key='members.read'", [f.tenantId, f.managerMembership]);
    try {
      expect(await searchStaffCandidates(f.context(f.managerId, "manager"), "Candidate")).toEqual([]);
    } finally {
      await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'members.read' from tenant_memberships where id=$2", [f.tenantId, f.managerMembership]);
    }
  });

  it("does not retain a removed location or accept a foreign membership", async () => {
    await f.admin.query("delete from membership_locations where membership_id=$1", [f.managerMembership]);
    try {
      expect(await searchStaffCandidates(f.context(f.managerId, "manager"), "Candidate")).toEqual([]);
      expect(await searchStaffCandidates({ ...f.context(f.managerId, "manager"), tenantId: f.otherTenant }, "Candidate")).toEqual([]);
    } finally {
      await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), f.tenantId, f.managerMembership, f.locationA]);
    }
  });

  it("allows the distinct live staff.read grant without member visibility", async () => {
    await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'staff.read' from tenant_memberships where id=$2", [f.tenantId, f.managerMembership]);
    try {
      const ctx = { ...f.context(f.managerId, "manager"), permissions: new Set(["staff.read"]) };
      expect((await searchStaffCandidates(ctx, "Candidate Staff")).map(row => row.personId)).toEqual([staffPerson]);
      expect(await searchStaffCandidates(ctx, "Candidate Outside")).toEqual([]);
      await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key='staff.read'", [f.tenantId, f.managerMembership]);
      expect(await searchStaffCandidates(ctx, "Candidate Staff")).toEqual([]);
    } finally {
      await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key='staff.read'", [f.tenantId, f.managerMembership]);
    }
  });
});
