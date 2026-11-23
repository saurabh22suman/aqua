import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db/tenant";
import { readLinkAuthorities } from "@/lib/services/member-link-authority";
import { readShowcaseFacts, resolvePublicShowcase, showcaseVisibilityFromFacts } from "@/lib/services/showcase/publication";
import { signShowcaseLinkToken } from "@/lib/services/showcase/link-token";
import { authorizeBoundLinks } from "@/lib/services/self-service-session";
import { fixture } from "../remediation-20261112/fixture";

let f: Awaited<ReturnType<typeof fixture>>;
const link = randomUUID();
const profile = randomUUID();
const decision = randomUUID();
const phone = "+919876543210";

beforeEach(async () => {
  f = await fixture();
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'members.link.confirm' from tenant_memberships where id=any($2::uuid[])", [f.tenantId, [f.membershipId, f.managerMembership]]);
  await f.admin.query("update persons set phone=$2,date_of_birth='1990-01-01' where id=$1", [f.personId, phone]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$5,$6,now(),$5,now(),'owner_attestation')", [link, f.tenantId, f.receptionistId, f.memberId, f.userId, phone]);
  await f.admin.query("insert into showcase_profiles(id,tenant_id,member_id,subject_person_id,chosen_name) values($1,$2,$3,$4,'Synthetic')", [profile, f.tenantId, f.memberId, f.personId]);
  await f.admin.query("insert into showcase_decisions(id,tenant_id,member_id,subject_person_id,decider_person_id,decider_user_id,member_link_id,decider_role,decision) values($1,$2,$3,$4,$4,$5,$6,'subject','approve')", [decision, f.tenantId, f.memberId, f.personId, f.receptionistId, link]);
});

afterEach(async () => {
  if (!f) return;
  await f.admin.query("delete from showcase_decisions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from showcase_profiles where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("rechecks deleted owner and all-location manager attestations on guardian decisions", async () => {
  const guardian = randomUUID(), relationship = randomUUID(), guardianLink = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Synthetic guardian',$3)", [guardian, f.tenantId, phone]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [relationship, f.tenantId, f.personId, guardian]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,$5,'active','club_record',$6,$7,now(),$6,now(),'owner_attestation')", [guardianLink, f.tenantId, f.receptionistId, relationship, f.memberId, f.userId, phone]);
  await f.admin.query("insert into showcase_decisions(id,tenant_id,member_id,subject_person_id,decider_person_id,decider_user_id,guardian_link_id,decider_role,decision) values($1,$2,$3,$4,$5,$6,$7,'guardian','approve')", [randomUUID(), f.tenantId, f.memberId, f.personId, guardian, f.receptionistId, guardianLink]);
  expect((await facts())?.guardianStandings[0]?.identityCurrent).toBe(true);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  expect((await facts())?.guardianStandings[0]?.identityCurrent).toBe(false);
  await f.admin.query("update tenant_memberships set all_locations=true where id=$1", [f.managerMembership]);
  await f.admin.query("delete from membership_locations where membership_id=$1", [f.managerMembership]);
  await f.admin.query("update guardian_child_links set account_binding_confirmed_by_user_id=$2,account_binding_basis='facility_manager_attestation',account_binding_facility_id=$3 where id=$1", [guardianLink, f.managerId, f.locationA]);
  expect((await facts())?.guardianStandings[0]?.identityCurrent).toBe(true);
});

async function facts() {
  return withTenant(f.tenantId, (tx) => readShowcaseFacts(tx, { tenantId: f.tenantId, key: profile, byProfile: true }));
}

async function managerMemberAttestation() {
  await f.admin.query("update member_account_links set account_binding_confirmed_by_user_id=$2,account_binding_basis='facility_manager_attestation',account_binding_facility_id=$3 where id=$1", [link, f.managerId, f.locationA]);
}

async function bound(audience: "member" | "guardian", linkId: string) {
  const account = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.receptionistId]);
  return withTenant(f.tenantId, (tx) => authorizeBoundLinks(tx, {
    tenantId: f.tenantId, userId: f.receptionistId, audience, linkIds: [linkId],
    accountPhone: account.rows[0]!.phone, subjectId: audience === "member" ? f.memberId : null,
  }));
}

it("removes a retained explicit assignment when its facility is deleted", async () => {
  const lookup = () => withTenant(f.tenantId, (tx) => readLinkAuthorities(tx, { tenantId: f.tenantId, userIds: [f.managerId] }));
  expect((await lookup()).get(f.managerId)?.facilityIds).toEqual([f.locationA]);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect((await f.admin.query("select id from membership_locations where membership_id=$1 and location_id=$2", [f.managerMembership, f.locationA])).rowCount).toBe(1);
  expect((await lookup()).get(f.managerId)?.facilityIds).toEqual([]);
});

it("rejects a cross-tenant facility assignment without changing the Manager scope", async () => {
  const otherLocation = randomUUID();
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Other tenant facility',true)", [otherLocation, f.otherTenant]);
  await expect(f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), f.tenantId, f.managerMembership, otherLocation])).rejects.toThrow();
  const authority = await withTenant(f.tenantId, (tx) => readLinkAuthorities(tx, { tenantId: f.tenantId, userIds: [f.managerId] }));
  expect(authority.get(f.managerId)?.facilityIds).toEqual([f.locationA]);
});

it("refuses a member session when its explicitly assigned attestation facility is deleted", async () => {
  await managerMemberAttestation();
  expect((await bound("member", link)).ok).toBe(true);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect((await bound("member", link)).ok).toBe(false);
});

it("removes a public member showcase when its explicitly assigned attestation facility is deleted", async () => {
  await managerMemberAttestation();
  const { token } = signShowcaseLinkToken({ tenantId: f.tenantId, publicationId: profile });
  expect(await resolvePublicShowcase(token)).not.toBeNull();
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect(await resolvePublicShowcase(token)).toBeNull();
});

it("refuses the guardian session and public child showcase after its assigned facility is deleted", async () => {
  const guardian = randomUUID(), relationship = randomUUID(), guardianLink = randomUUID();
  await f.admin.query("update persons set date_of_birth='2015-01-01' where id=$1", [f.personId]);
  await f.admin.query("delete from showcase_decisions where id=$1", [decision]);
  await f.admin.query("insert into showcase_decisions(id,tenant_id,member_id,subject_person_id,decider_person_id,decider_user_id,member_link_id,decider_role,decision) values($1,$2,$3,$4,$4,$5,$6,'subject','permit')", [randomUUID(), f.tenantId, f.memberId, f.personId, f.receptionistId, link]);
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Synthetic guardian',$3)", [guardian, f.tenantId, phone]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [relationship, f.tenantId, f.personId, guardian]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis,account_binding_facility_id) values($1,$2,$3,$4,$5,'active','club_record',$6,$7,now(),$8,now(),'facility_manager_attestation',$9)", [guardianLink, f.tenantId, f.receptionistId, relationship, f.memberId, f.userId, phone, f.managerId, f.locationA]);
  await f.admin.query("insert into showcase_decisions(id,tenant_id,member_id,subject_person_id,decider_person_id,decider_user_id,guardian_link_id,decider_role,decision) values($1,$2,$3,$4,$5,$6,$7,'guardian','approve')", [randomUUID(), f.tenantId, f.memberId, f.personId, guardian, f.receptionistId, guardianLink]);
  const { token } = signShowcaseLinkToken({ tenantId: f.tenantId, publicationId: profile });
  expect((await bound("guardian", guardianLink)).ok).toBe(true);
  expect(await resolvePublicShowcase(token)).not.toBeNull();
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect(await resolvePublicShowcase(token)).toBeNull();
  expect((await bound("guardian", guardianLink)).ok).toBe(false);
});

it("preserves an owner's existing unrestricted manager-basis attestation after facility deletion", async () => {
  await f.admin.query("update member_account_links set account_binding_confirmed_by_user_id=$2,account_binding_basis='facility_manager_attestation',account_binding_facility_id=$3 where id=$1", [link, f.userId, f.locationA]);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect((await bound("member", link)).ok).toBe(true);
  expect((await facts())?.subjectIdentityCurrent).toBe(true);
});

it("preserves an explicitly granted non-Manager's assigned-facility authority", async () => {
  await f.admin.query("update roles set key='accountant' where id=(select role_id from tenant_memberships where id=$1)", [f.managerMembership]);
  await managerMemberAttestation();
  const lookup = () => withTenant(f.tenantId, (tx) => readLinkAuthorities(tx, { tenantId: f.tenantId, userIds: [f.managerId] }));
  expect((await lookup()).get(f.managerId)).toMatchObject({ live: true, unrestricted: false, facilityIds: [f.locationA] });
  expect((await bound("member", link)).ok).toBe(true);
  expect((await facts())?.subjectIdentityCurrent).toBe(true);
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key='members.link.confirm'", [f.tenantId, f.managerMembership]);
  expect((await bound("member", link)).ok).toBe(false);
  expect((await facts())?.subjectIdentityCurrent).toBe(false);
});

it("keeps same-phone identity valid independently of a deleted attestation facility", async () => {
  await managerMemberAttestation();
  await f.admin.query("update users set phone=$2 where id=$1", [f.receptionistId, phone]);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect((await bound("member", link)).ok).toBe(true);
  expect((await facts())?.subjectIdentityCurrent).toBe(true);
});

it("withdraws a deleted user's live grant even when their membership remains active", async () => {
  const lookup = () => withTenant(f.tenantId, (tx) => readLinkAuthorities(tx, { tenantId: f.tenantId, userIds: [f.userId] }));
  expect((await lookup()).get(f.userId)?.live).toBe(true);
  expect((await withTenant(f.otherTenant, (tx) => readLinkAuthorities(tx, { tenantId: f.otherTenant, userIds: [f.userId] }))).has(f.userId)).toBe(false);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  expect((await lookup()).get(f.userId)?.live ?? false).toBe(false);
});

it("withdraws publication when its mismatched account relied on a now-deleted owner attester", async () => {
  const before = await facts();
  expect(before?.subjectIdentityCurrent).toBe(true);
  expect(before && showcaseVisibilityFromFacts(before).publishable).toBe(true);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  const after = await facts();
  expect(after?.subjectIdentityCurrent).toBe(false);
  expect(after && showcaseVisibilityFromFacts(after).publishable).toBe(false);
});

it("honours an all-location manager's attestation without a separate assignment row", async () => {
  await f.admin.query("update tenant_memberships set all_locations=true where id=$1", [f.managerMembership]);
  await f.admin.query("delete from membership_locations where membership_id=$1", [f.managerMembership]);
  await f.admin.query("update member_account_links set account_binding_confirmed_by_user_id=$2,account_binding_basis='facility_manager_attestation',account_binding_facility_id=$3 where id=$1", [link, f.managerId, f.locationA]);
  const authority = await withTenant(f.tenantId, (tx) => readLinkAuthorities(tx, { tenantId: f.tenantId, userIds: [f.managerId] }));
  expect(authority.get(f.managerId)?.facilityIds).toContain(f.locationA);
  const snapshot = await facts();
  expect(snapshot?.subjectIdentityCurrent).toBe(true);
  expect(snapshot && showcaseVisibilityFromFacts(snapshot).publishable).toBe(true);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.managerId]);
  expect((await facts())?.subjectIdentityCurrent).toBe(false);
  await f.admin.query("update users set deleted_at=null where id=$1", [f.managerId]);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  expect((await facts())?.subjectIdentityCurrent).toBe(false);
});
