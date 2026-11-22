import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { resolveAudienceUserIds } from "@/lib/services/announcement-audience";

let f: Awaited<ReturnType<typeof fixture>>;
let linkedUser: string;
const memberLink = randomUUID();
beforeAll(async () => {
  f = await fixture();
  linkedUser = randomUUID();
  const phone = `+91${String(BigInt('0x' + linkedUser.replaceAll('-', '').slice(0, 12)) % 9000000000n + 1000000000n)}`;
  await f.admin.query("insert into users(id,phone) values($1,$2)", [linkedUser, phone]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$5,$5,now(),'owner_attestation')", [memberLink, f.tenantId, linkedUser, f.memberId, f.userId]);
  await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, f.memberId, f.batchA]);
});

it("includes a current linked member in that member's batch audience", async () => {
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "batch", f.batchA));
  expect(ids).toContain(linkedUser);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  if (linkedUser) await f.admin.query("delete from users where id=$1", [linkedUser]);
  await f.cleanup();
});

it("includes a confirmed active linked member without requiring users.person_id", async () => {
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "all"));
  expect(ids).toContain(linkedUser);
});

it.each(["all", "batch"] as const)("does not revive a revoked member link through legacy person association for %s", async (audience) => {
  await f.admin.query("update users set person_id=$1 where id=$2", [f.personId, linkedUser]);
  await f.admin.query("update member_account_links set status='revoked',revoked_at=now(),revoked_by_user_id=$1 where id=$2", [f.userId, memberLink]);
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, audience, audience === "batch" ? f.batchA : undefined));
  expect(ids).not.toContain(linkedUser);
});
