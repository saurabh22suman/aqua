// @vitest-environment node
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ctx: vi.fn(), locations: vi.fn(), branding: vi.fn(), allowed: true }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: state.ctx }));
vi.mock("@/lib/auth/surface-access", () => ({ SURFACE_OWNER: "owner", canAccessSurface: () => state.allowed }));
vi.mock("@/lib/services/people", () => ({ listLocations: state.locations }));
vi.mock("@/lib/services/branding", () => ({ getBranding: state.branding }));
vi.mock("@/lib/nav", () => ({ ownerNavForPermissions: () => [], ownerSidebarGroupsForPermissions: () => [] }));
vi.mock("@/components/owner-ui/owner-navigation", () => ({ ownerSidebarGroupsWithBookings: () => [] }));
vi.mock("@/components/owner-shell", () => ({ OwnerShell: ({ children }: { children: React.ReactNode }) => <div data-testid="owner-shell">{children}</div>, ownerRoleLabel: () => "Owner" }));
import OwnerLayout from "@/app/(owner)/layout";

beforeEach(() => {
  state.allowed = true;
  state.ctx.mockReset().mockResolvedValue({ roleKey: "owner", permissions: new Set(), features: new Set() });
  state.locations.mockReset().mockResolvedValue([]);
  state.branding.mockReset().mockResolvedValue({ displayName: "Club", initials: "C" });
});

it("preserves authorized server-rendered shell and page content", async () => {
  const tree = await OwnerLayout({ children: <main>Authorized report</main> });
  const html = renderToString(tree);
  expect(html).toContain("<!--$-->");
  expect(html).toContain('data-testid="owner-shell"');
  expect(html).toContain("Authorized report");
  expect(state.locations).toHaveBeenCalledOnce();
  expect(state.branding).toHaveBeenCalledOnce();
});

it("redirects a missing session before protected reads", async () => {
  state.ctx.mockRejectedValue(new Error("missing session"));
  await expect(OwnerLayout({ children: <main>Protected report</main> })).rejects.toThrow("redirect");
  expect(state.locations).not.toHaveBeenCalled();
  expect(state.branding).not.toHaveBeenCalled();
});

it("does not read or render the protected shell after a denied surface check", async () => {
  state.allowed = false;
  await expect(OwnerLayout({ children: <main>Protected report</main> })).rejects.toThrow("not found");
  expect(state.locations).not.toHaveBeenCalled();
  expect(state.branding).not.toHaveBeenCalled();
});

it("provides an accessible owner loading fallback when the shell subtree suspends", async () => {
  function Pending(): never { throw new Promise(() => {}); }
  const tree = await OwnerLayout({ children: <Pending /> });
  const html = renderToString(tree);
  expect(html).toMatch(/role="status"/);
  expect(html).toMatch(/loading.*workspace/i);
});
