import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture } from "@/tests/remediation-20261112/fixture";

const state = vi.hoisted(() => ({ ctx: vi.fn(), locations: [] as Array<{ id: string; name: string }>, guideHomeHref: undefined as string | undefined }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: state.ctx }));
vi.mock("@/components/owner-shell", () => ({ OwnerShell: (props: { locations: Array<{ id: string; name: string }>; guideHomeHref?: string }) => { state.locations = props.locations; state.guideHomeHref = props.guideHomeHref; return <main>Workspace</main>; }, ownerRoleLabel: () => "Accountant" }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: "Synthetic Club", logoUrl: null }) }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/terminology", () => ({ getTerminology: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/lib/auth/surface-access", () => ({ canAccessSurface: () => true, SURFACE_OWNER: "owner" }));
vi.mock("@/lib/nav", () => ({ ownerNavForPermissions: () => [], ownerSidebarGroupsForPermissions: () => [] }));
vi.mock("@/components/owner-ui/owner-navigation", () => ({ ownerSidebarGroupsWithBookings: () => [] }));
import OwnerLayout from "@/app/(owner)/layout";
import { staffSiteContext } from "@/lib/services/staff-scope";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update roles set key='accountant' where tenant_id=$1 and key='manager'", [f.tenantId]);
  state.ctx.mockResolvedValue({ ...f.context(f.managerId, "manager"), roleKey: "accountant" });
});
afterAll(async () => { if (f) await f.cleanup(); });

it("passes only the restricted accountant's assigned live site to the owner picker", async () => {
  renderToStaticMarkup(await OwnerLayout({ children: <p>Content</p> }));
  expect(state.locations.map((site) => site.id)).toEqual([f.locationA]);
  expect(await staffSiteContext({ ...f.context(f.managerId, "manager"), roleKey: "accountant" })).toBe("A");
});

it("retains both sites for the live unrestricted owner", async () => {
  state.ctx.mockResolvedValueOnce(f.context());
  renderToStaticMarkup(await OwnerLayout({ children: <p>Content</p> }));
  expect(state.locations.map((site) => site.id)).toEqual([f.locationA, f.locationB]);
});

it("derives guide availability from dashboard permission, including the accountant no-guide case", async () => {
  state.ctx.mockResolvedValueOnce({ ...f.context(f.managerId, "manager"), roleKey: "accountant", permissions: new Set<string>() });
  renderToStaticMarkup(await OwnerLayout({ children: <p>Content</p> }));
  expect(state.guideHomeHref).toBeUndefined();
  state.ctx.mockResolvedValueOnce({ ...f.context(), permissions: new Set(["dashboard.view"]) });
  renderToStaticMarkup(await OwnerLayout({ children: <p>Content</p> }));
  expect(state.guideHomeHref).toBe("/owner");
});

it("does not populate the picker for a revoked membership", async () => {
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  try {
    renderToStaticMarkup(await OwnerLayout({ children: <p>Content</p> }));
    expect(state.locations).toEqual([]);
    expect(await staffSiteContext({ ...f.context(f.managerId, "manager"), roleKey: "accountant" })).toBe("No assigned facilities");
  } finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]); }
});
