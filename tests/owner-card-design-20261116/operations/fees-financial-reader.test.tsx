// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
const state = vi.hoisted(() => ({ ctx: null as Ctx | null }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { fixture } from "@/tests/remediation-20261112/fixture";
import Page from "@/app/(owner)/owner/fees/page";
import { renderToStaticMarkup } from "react-dom/server";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2)", [f.tenantId, f.managerMembership]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'reports.financial' from tenant_memberships where id=$2", [f.tenantId, f.managerMembership]);
  state.ctx = { ...f.context(f.managerId, "manager"), permissions: new Set(["reports.financial"]), features: new Set(["reports"]) };
});
afterAll(async () => { if (f) await f.cleanup(); });
it("loads the real financial overview without requiring members.read", async () => {
  expect(await Page({ searchParams: Promise.resolve({ facility: "all", from: "2026-11-01", to: "2026-12-01" }) })).toBeTruthy();
});
it("links daily collections to the selected club, without implying the period applies to the daily report", async () => {
  const page = await Page({ searchParams: Promise.resolve({ facility: f.locationA, from: "2026-10-01", to: "2026-11-01" }) });
  const markup = renderToStaticMarkup(page);
  const link = markup.match(/href="([^\"]*)"[^>]*>\s*<span>\s*Daily collections/);
  expect(link).not.toBeNull();
  const target = new URL(link![1]!.replaceAll("&amp;", "&"), "http://localhost");
  expect(target.pathname).toBe("/owner/reports/collections");
  expect(target.searchParams.get("facility")).toBe(f.locationA);
  expect(target.searchParams.has("from")).toBe(false);
  expect(target.searchParams.has("to")).toBe(false);
});
