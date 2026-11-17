// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
const state = vi.hoisted(() => ({ ctx: null as Ctx | null }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { fixture } from "@/tests/remediation-20261112/fixture";
import Page from "@/app/(owner)/owner/schedule/page";
import { getScheduleGrid } from "@/lib/services/schedule-grid";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key not in ('programs.read','attendance.read')", [f.tenantId, f.managerMembership]);
  state.ctx = { ...f.context(f.managerId, "manager"), permissions: new Set(["programs.read", "attendance.read"]) };
  await f.admin.query("insert into sessions (id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values (gen_random_uuid(),$1,$2,$4,'2026-11-17','2026-11-17T04:30Z','2026-11-17T05:30Z'),(gen_random_uuid(),$1,$3,$5,'2026-11-17','2026-11-17T04:30Z','2026-11-17T05:30Z')", [f.tenantId, f.batchA, f.batchB, f.locationA, f.locationB]);
});
afterAll(async () => { if (f) await f.cleanup(); });
it("renders schedule for a restricted attendance reader without members.read and only reads their facility", async () => {
  const page = await Page({ searchParams: Promise.resolve({ view: "agenda", date: "2026-11-17", facility: "all" }) });
  expect(page).toBeTruthy();
  const rows = await getScheduleGrid(state.ctx!, { fromDate: "2026-11-17", toDate: "2026-11-17" });
  expect(rows.map(row => row.batchName)).toEqual(["Batch A"]);
  expect(await getScheduleGrid(state.ctx!, { fromDate: "2026-11-17", toDate: "2026-11-17", locationId: f.locationB })).toEqual([]);
});
