import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { resolveAudienceUserIds } from "@/lib/services/announcement-audience";

let f: Awaited<ReturnType<typeof fixture>>;
const guardianUser = randomUUID(), guardianPerson = randomUUID(), relationship = randomUUID(), link = randomUUID();
const phone = `+91${String(BigInt('0x' + guardianUser.replaceAll('-', '').slice(0, 12)) % 9000000000n + 1000000000n)}`;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into users(id,phone) values($1,$2)", [guardianUser, phone]);
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Synthetic guardian',$3)", [guardianPerson, f.tenantId, phone]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [relationship, f.tenantId, f.personId, guardianPerson]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values($1,$2,$3,$4,$5,'active','club_record',$6,$7,now())", [link, f.tenantId, guardianUser, relationship, f.memberId, f.userId, phone]);
  await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, f.memberId, f.batchA]);
});

it.each(["all", "batch"] as const)("does not revive an explicitly revoked guardian through a legacy person association for %s", async (audience) => {
  await f.admin.query("update guardian_child_links set status='active', revoked_at=null, revoked_by_user_id=null where id=$1", [link]);
  await f.admin.query("update users set person_id=$1 where id=$2", [guardianPerson, guardianUser]);
  await f.admin.query("update guardian_child_links set status='revoked', revoked_at=now(), revoked_by_user_id=$1 where id=$2", [f.userId, link]);
  const result = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, audience, audience === "batch" ? f.batchA : undefined));
  expect(result).not.toContain(guardianUser);
});

it.each(["all", "batch"] as const)("includes a live authorized guardian in %s", async (audience) => {
  await f.admin.query("update guardian_child_links set status='active', revoked_at=null, revoked_by_user_id=null where id=$1", [link]);
  const result = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, audience, audience === "batch" ? f.batchA : undefined));
  expect(result).toContain(guardianUser);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from users where id=$1", [guardianUser]);
  await f.cleanup();
});

it("includes a currently authorized linked guardian and excludes it after revocation", async () => {
  const resolve = () => withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "parents"));
  await f.admin.query("update guardian_child_links set status='active', revoked_at=null, revoked_by_user_id=null where id=$1", [link]);
  // Legacy person association must not revive an explicitly revoked link.
  await f.admin.query("update users set person_id=$1 where id=$2", [guardianPerson, guardianUser]);
  expect(await resolve()).toContain(guardianUser);
  await f.admin.query("update guardian_child_links set status='revoked', revoked_at=now(), revoked_by_user_id=$1 where id=$2", [f.userId, link]);
  expect(await resolve()).not.toContain(guardianUser);
});
