// Supplemental post-implementation coverage; not historical RED evidence.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { getTenantDiagnostics } from "@/db/ops-diagnostics-view";
import { asTenantId } from "@/lib/ids";
const tenant = randomUUID();
const otherTenant = randomUUID();
const role = randomUUID();
const otherRole = randomUUID();
const userIds: string[] = [];
const memberships: string[] = [];
beforeAll(async () => {
  await admin.query("insert into tenants (id,slug,name,status,timezone) values ($1,$2,'Paging fixture','active','Asia/Kolkata'),($3,$4,'Other fixture','active','Asia/Kolkata')", [tenant, `diag-${tenant}`, otherTenant, `diag-${otherTenant}`]);
  await admin.query("insert into roles (id,tenant_id,key,name) values ($1,$2,'coach','Coach'),($3,$4,'coach','Coach')", [role, tenant, otherRole, otherTenant]);
  for (let i = 0; i < 52; i++) {
    const user = randomUUID(); const membership = randomUUID();
    userIds.push(user); memberships.push(membership);
    await admin.query("insert into users (id,phone,better_auth_id) values ($1,$2,$3)", [user, `+${BigInt(`0x${user.replaceAll("-", "").slice(0, 12)}`).toString().padStart(15, "1").slice(0, 15)}`, `diag-${user}`]);
    await admin.query("insert into tenant_memberships (id,tenant_id,user_id,role_id,status,created_at) values ($1,$2,$3,$4,'active', $5)", [membership, i === 51 ? otherTenant : tenant, user, i === 51 ? otherRole : role, new Date(Date.UTC(2026, 0, 1, 0, 0, i))]);
  }
});
afterAll(async () => {
  await admin.query("delete from tenant_memberships where tenant_id = any($1::uuid[])", [[tenant, otherTenant]]);
  await admin.query("delete from users where id = any($1::uuid[])", [userIds]);
  await admin.query("delete from roles where tenant_id = any($1::uuid[])", [[tenant, otherTenant]]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [[tenant, otherTenant]]);
});
it("reaches the oldest membership on page two and refuses a different tenant's ID", async () => {
  const result = await getTenantDiagnostics(asTenantId(tenant), { page: 2, membershipId: memberships[51] });
  expect(result.total).toBe(51);
  expect(result.memberships.map((entry) => entry.membershipId)).toEqual([memberships[0]]);
  expect(result.selected).toBeNull();
});
