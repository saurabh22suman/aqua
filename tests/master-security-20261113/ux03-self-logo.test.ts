import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { readSelfHome } from "@/lib/services/self-home";
import type { SelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>;
const digest = "a".repeat(64);
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("projects only a validated same-tenant logo for an already-authorized guardian scope", async () => {
  const ref = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1::jsonb where id=$2", [JSON.stringify({ logo: ref }), f.tenantId]);
  const scope = { kind: "self_session", audience: "guardian", tenantId: f.tenantId, userId: f.userId, memberId: null, childMemberIds: [f.memberId], linkIds: [], sessionId: "synthetic" } as SelfScope;
  const view = await withTenant(f.tenantId, (tx) => readSelfHome(tx, scope, "guardian"));
  expect(view).toMatchObject({ clubLogoUrl: `/clubs/${f.tenantId}/branding/logo/${digest}?source=guardian` });
  await f.admin.query("update tenants set branding=$1::jsonb where id=$2", [JSON.stringify({ logo: { ...ref, objectKey: `tenant-branding/${f.otherTenant}/logo/${digest}.png` } }), f.tenantId]);
  const invalid = await withTenant(f.tenantId, (tx) => readSelfHome(tx, scope, "guardian"));
  expect(invalid).toMatchObject({ clubLogoUrl: null });
});
