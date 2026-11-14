import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";

const session = vi.hoisted(() => ({ id: "", live: true }));
const self = vi.hoisted(() => ({ tenantId: "", audience: "member", live: false, kind: "self_session", readAllowed: true }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: async () => session.live ? { user: { id: session.id }, session: { createdAt: new Date() } } : null } } }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveSelfScope: async (audience: string) => self.live && audience === self.audience ? {
  scope: { tenantId: self.tenantId, kind: self.kind },
  read: async (callback: (tx: unknown, scope: { tenantId: string }) => Promise<unknown>) => {
    if (!self.readAllowed) throw new Error("scope revoked");
    return callback({}, { tenantId: self.tenantId });
  },
} : null }));

async function targetReader() { return readAuthorizedBrandingTarget; }
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  session.id = `branding-${f.userId}`;
  await f.admin.query("update users set better_auth_id=$1 where id=$2", [session.id, f.userId]);
});
afterAll(async () => { await f.cleanup(); });

it("reads only the requested live staff membership, regardless of selected club", async () => {
  const read = await targetReader();
  expect(await read(f.tenantId, "staff", async () => "authorized")).toBe("authorized");
  expect(await read(f.otherTenant, "staff", async () => "should not read")).toBeNull();
});
it("refuses expired sessions and revoked memberships without calling the reader", async () => {
  const read = await targetReader();
  const callback = vi.fn(async () => "unexpected");
  session.live = false;
  expect(await read(f.tenantId, "staff", callback)).toBeNull();
  session.live = true;
  await f.admin.query("update tenant_memberships set deleted_at=now() where id=$1", [f.membershipId]);
  try { expect(await read(f.tenantId, "staff", callback)).toBeNull(); }
  finally { await f.admin.query("update tenant_memberships set deleted_at=null where id=$1", [f.membershipId]); }
  expect(callback).not.toHaveBeenCalled();
});
it.each(["member", "guardian"] as const)("binds the %s source to its own live self scope and does not fall back to staff", async (audience) => {
  const read = await targetReader();
  self.tenantId = f.tenantId; self.audience = audience; self.live = true;
  expect(await read(f.tenantId, audience, async () => "self")).toBe("self");
  expect(await read(f.otherTenant, audience, async () => "wrong tenant")).toBeNull();
  self.live = false;
  expect(await read(f.tenantId, audience, async () => "staff fallback")).toBeNull();
});
it("accepts staff-derived self scope only when its authoritative read revalidates", async () => {
  self.tenantId = f.tenantId; self.audience = "member"; self.kind = "staff_session"; self.live = true;
  const callback = vi.fn(async () => "authorized");
  try {
    expect(await readAuthorizedBrandingTarget(f.tenantId, "member", callback)).toBe("authorized");
    self.readAllowed = false;
    expect(await readAuthorizedBrandingTarget(f.tenantId, "member", callback)).toBeNull();
    expect(callback).toHaveBeenCalledTimes(1);
  } finally { self.kind = "self_session"; self.live = false; self.readAllowed = true; }
});
