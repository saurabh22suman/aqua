import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { confirmLinkBinding, withdrawLinkBinding } from "@/lib/services/member-link-binding";

let f: Awaited<ReturnType<typeof fixture>>;
const linkId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'members.link.confirm' from tenant_memberships where id=$2", [f.tenantId,f.managerMembership]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id) values($1,$2,$3,$4,'active','club_record',$5)", [linkId,f.tenantId,f.receptionistId,f.memberId,f.userId]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("does not confirm or audit a link revoked while the confirmation is waiting", async () => {
  const blocker = await f.admin.connect();
  let released = false;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query<{pid:number}>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await blocker.query("update member_account_links set status='revoked',revoked_at=now(),revoked_by_user_id=$2 where id=$1", [linkId,f.userId]);
    const confirmation = confirmLinkBinding(f.context(f.managerId,"manager"), {audience:"member",linkId});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%member_account_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await blocker.query("commit"); released = true;
    const result = await confirmation;
    const row = (await f.admin.query("select status,account_binding_confirmed_by_user_id,account_binding_basis,account_binding_facility_id from member_account_links where id=$1",[linkId])).rows[0];
    const audits = (await f.admin.query<{n:number}>("select count(*)::int n from audit_log where tenant_id=$1 and entity_id=$2 and action='member.account_link.confirm_binding'",[f.tenantId,f.memberId])).rows[0]!.n;
    console.log(JSON.stringify({scenario:"manager A confirms while link revocation commits",result:result.kind,status:row.status,confirmedByManager:row.account_binding_confirmed_by_user_id===f.managerId,basis:row.account_binding_basis,facilityIsA:row.account_binding_facility_id===f.locationA,auditCount:audits}));
    expect(result).toMatchObject({kind:"error",code:"not_found"});
    expect(row.account_binding_confirmed_by_user_id).toBeNull();
    expect(audits).toBe(0);
  } finally {
    if (!released) await blocker.query("rollback");
    blocker.release();
  }
}, 30000);

it("refuses confirmation when the subject moves outside the actor's facility while waiting", async () => {
  await f.admin.query("update member_account_links set status='active',revoked_at=null,revoked_by_user_id=null,account_binding_confirmed_by_user_id=null,account_binding_confirmed_at=null,account_binding_basis=null,account_binding_facility_id=null where id=$1", [linkId]);
  const blocker = await f.admin.connect();
  let released = false;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query<{pid:number}>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await blocker.query("select id from member_account_links where id=$1 for update", [linkId]);
    const confirmation = confirmLinkBinding(f.context(f.managerId,"manager"), {audience:"member",linkId});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%member_account_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await f.admin.query("update members set location_id=$2 where id=$1", [f.memberId,f.locationB]);
    await blocker.query("commit"); released = true;
    const result = await confirmation;
    const row = (await f.admin.query("select account_binding_facility_id from member_account_links where id=$1",[linkId])).rows[0];
    console.log(JSON.stringify({scenario:"subject moved from A to B while confirmation waited",result:result.kind,attestationFacilityIsA:row.account_binding_facility_id===f.locationA}));
    expect(result).toMatchObject({kind:"error",code:"not_found"});
    expect(row.account_binding_facility_id).toBeNull();
    expect((await f.admin.query<{n:number}>("select count(*)::int n from audit_log where tenant_id=$1 and entity_id=$2 and action='member.account_link.confirm_binding'", [f.tenantId,f.memberId])).rows[0]!.n).toBe(0);
  } finally {
    if (!released) await blocker.query("rollback");
    blocker.release();
    await f.admin.query("update members set location_id=$2 where id=$1", [f.memberId,f.locationA]);
  }
}, 30000);

it("does not withdraw or audit a link revoked while withdrawal is waiting", async () => {
  await f.admin.query("update member_account_links set status='active',revoked_at=null,revoked_by_user_id=null,account_binding_confirmed_by_user_id=$2,account_binding_confirmed_at=now(),account_binding_basis='facility_manager_attestation',account_binding_facility_id=$3 where id=$1", [linkId, f.managerId, f.locationA]);
  const blocker = await f.admin.connect();
  let released = false;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query<{pid:number}>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await blocker.query("update member_account_links set status='revoked',revoked_at=now(),revoked_by_user_id=$2 where id=$1", [linkId,f.userId]);
    const withdrawal = withdrawLinkBinding(f.context(f.managerId,"manager"), {audience:"member",linkId});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%member_account_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await blocker.query("commit"); released = true;
    const result = await withdrawal;
    const row = (await f.admin.query("select status,account_binding_confirmed_by_user_id from member_account_links where id=$1",[linkId])).rows[0];
    const audits = (await f.admin.query<{n:number}>("select count(*)::int n from audit_log where tenant_id=$1 and entity_id=$2 and action='member.account_link.withdraw_binding'",[f.tenantId,f.memberId])).rows[0]!.n;
    console.log(JSON.stringify({scenario:"withdrawal after concurrent revocation",result:result.kind,status:row.status,confirmedByManager:row.account_binding_confirmed_by_user_id===f.managerId,auditCount:audits}));
    expect(result).toMatchObject({kind:"error",code:"not_found"});
    expect(row.account_binding_confirmed_by_user_id).toBe(f.managerId);
    expect(audits).toBe(0);
  } finally {
    if (!released) await blocker.query("rollback");
    blocker.release();
  }
}, 30000);

it("rechecks a guardian child's facility after waiting for the link", async () => {
  const guardian = randomUUID(), relationship = randomUUID(), guardianLink = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Synthetic guardian')", [guardian, f.tenantId]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [relationship, f.tenantId, f.personId, guardian]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id) values($1,$2,$3,$4,$5,'active','club_record',$6)", [guardianLink,f.tenantId,f.receptionistId,relationship,f.memberId,f.userId]);
  const blocker = await f.admin.connect();
  let released = false;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query<{pid:number}>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await blocker.query("select id from guardian_child_links where id=$1 for update", [guardianLink]);
    const confirmation = confirmLinkBinding(f.context(f.managerId,"manager"), {audience:"guardian",linkId:guardianLink});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%guardian_child_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await f.admin.query("update members set location_id=$2 where id=$1", [f.memberId,f.locationB]);
    await blocker.query("commit"); released = true;
    const result = await confirmation;
    const row = (await f.admin.query("select account_binding_confirmed_by_user_id from guardian_child_links where id=$1", [guardianLink])).rows[0];
    const audits = (await f.admin.query<{n:number}>("select count(*)::int n from audit_log where tenant_id=$1 and entity_id=$2 and action='guardian.child_link.confirm_binding'", [f.tenantId,relationship])).rows[0]!.n;
    expect(result).toMatchObject({kind:"error",code:"not_found"});
    expect(row.account_binding_confirmed_by_user_id).toBeNull();
    expect(audits).toBe(0);
    await f.admin.query("update members set location_id=$2 where id=$1", [f.memberId,f.locationA]);
    await blocker.query("begin"); released = false;
    await blocker.query("select id from guardian_child_links where id=$1 for update", [guardianLink]);
    const afterRemoval = confirmLinkBinding(f.context(f.managerId,"manager"), {audience:"guardian",linkId:guardianLink});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%guardian_child_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await f.admin.query("update guardianships set deleted_at=now() where id=$1", [relationship]);
    await blocker.query("commit"); released = true;
    expect(await afterRemoval).toMatchObject({kind:"error",code:"not_found"});
    expect((await f.admin.query<{n:number}>("select count(*)::int n from audit_log where tenant_id=$1 and entity_id=$2 and action='guardian.child_link.confirm_binding'", [f.tenantId,relationship])).rows[0]!.n).toBe(0);
  } finally {
    if (!released) await blocker.query("rollback");
    blocker.release();
    await f.admin.query("update members set location_id=$2 where id=$1", [f.memberId,f.locationA]);
    await f.admin.query("delete from guardian_child_links where id=$1", [guardianLink]);
    await f.admin.query("delete from guardianships where id=$1", [relationship]);
    await f.admin.query("delete from persons where id=$1", [guardian]);
  }
}, 30000);

it("rechecks the member phone after waiting for the link", async () => {
  await f.admin.query("update member_account_links set status='active',revoked_at=null,revoked_by_user_id=null,verified_phone=null,account_binding_confirmed_by_user_id=null,account_binding_confirmed_at=null,account_binding_basis=null,account_binding_facility_id=null where id=$1", [linkId]);
  const blocker = await f.admin.connect();
  let released = false;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query<{pid:number}>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await blocker.query("select id from member_account_links where id=$1 for update", [linkId]);
    const confirmation = confirmLinkBinding(f.context(f.managerId,"manager"), {audience:"member",linkId});
    await vi.waitFor(async () => {
      const waiting = await f.admin.query<{n:number}>("select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%member_account_links%'", [pid]);
      expect(waiting.rows[0]!.n).toBeGreaterThan(0);
    }, {timeout:10000,interval:50});
    await f.admin.query("update persons set phone='+919876543210' where id=$1", [f.personId]);
    await blocker.query("commit"); released = true;
    expect(await confirmation).toMatchObject({kind:"error",code:"not_confirmable"});
    const row = (await f.admin.query("select account_binding_confirmed_by_user_id from member_account_links where id=$1", [linkId])).rows[0];
    expect(row.account_binding_confirmed_by_user_id).toBeNull();
  } finally {
    if (!released) await blocker.query("rollback");
    blocker.release();
    await f.admin.query("update persons set phone=null where id=$1", [f.personId]);
  }
}, 30000);
