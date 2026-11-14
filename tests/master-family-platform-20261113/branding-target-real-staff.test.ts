import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
const request = vi.hoisted(() => ({ headers: new Headers(), selfToken: "" }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => ({ get: (name: string) => name === "aqua_self_session" && request.selfToken ? { value: request.selfToken } : undefined }) }));
import { ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { tenants } from "@/db/schema/tenants";
import { asTenantId } from "@/lib/ids";

let f: Awaited<ReturnType<typeof fixture>>, cookie: string, otherMembership: string;
beforeAll(async () => {
  f = await fixture();
  const { rows: [user] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId]);
  const baId = await ensureBaUserForPhone(user.phone);
  await setCredential(baId, "123456");
  const signed = await pinLogin(user.phone, "123456");
  cookie = signed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const role = randomUUID(); otherMembership = randomUUID();
  await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'coach','Coach','/coach',2)", [role, f.otherTenant]);
  await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',false)", [otherMembership, f.otherTenant, f.userId, role]);
});
it("does not turn a dead self-service cookie into staff access for member or guardian source", async () => {
  request.headers = new Headers({ cookie });
  request.selfToken = `s1.${f.userId}.${"a".repeat(64)}`;
  const callback = vi.fn(async () => "private");
  expect(await readAuthorizedBrandingTarget(f.tenantId, "member", callback)).toBeNull();
  expect(await readAuthorizedBrandingTarget(f.tenantId, "guardian", callback)).toBeNull();
  expect(callback).not.toHaveBeenCalled();
  expect(await readAuthorizedBrandingTarget(f.tenantId, "staff", async () => "staff")).toBe("staff");
  request.selfToken = "";
});
afterAll(async () => { await f.cleanup(); });

it("reauthorizes a real staff session for the requested club independently of the selected cookie", async () => {
  request.headers = new Headers({ cookie: `${cookie}; aqua_active_club=${f.tenantId}` });
  const read = (id: string) => readAuthorizedBrandingTarget(id, "staff", async (tx) => {
    const [row] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, asTenantId(id)));
    return row?.name ?? null;
  });
  expect(await read(f.tenantId)).toBe("Remediation A");
  expect(await read(f.otherTenant)).toBe("Remediation B");
  expect(await read(randomUUID())).toBeNull();
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [otherMembership]);
  expect(await read(f.otherTenant)).toBeNull();
  expect(await read(f.tenantId)).toBe("Remediation A");
  request.headers = new Headers();
  expect(await read(f.tenantId)).toBeNull();
});
