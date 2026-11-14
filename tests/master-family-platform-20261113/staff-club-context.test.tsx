import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "coach" }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "tenant-example", roleKey: state.role, allLocations: true, locationIds: [] }) }));
vi.mock("@/lib/auth/surface-access", () => ({ canAccessSurface: () => true, SURFACE_COACH: "coach", SURFACE_RECEPTION: "reception" }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: "Example Sports Club", fallbackDisplayName: "Example Sports Club" }) }));
vi.mock("@/lib/services/staff-scope", () => ({ staffSiteContext: async () => "Example facility" }));
vi.mock("@/components/staff-ui/staff-bottom-nav", () => ({ StaffBottomNav: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/coach", notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
import CoachLayout from "@/app/(coach)/layout";
import ReceptionLayout from "@/app/(reception)/layout";
import WorkerLayout from "@/app/(worker)/layout";

it.each([["coach", CoachLayout], ["reception", ReceptionLayout], ["worker", WorkerLayout]] as const)("shows the active club on the %s task surface", async (_role, Layout) => {
  const html = renderToStaticMarkup(await Layout({ children: <p>Task</p> }));
  expect(html).toContain("Example Sports Club");
});

it.each([["coach", CoachLayout], ["receptionist", ReceptionLayout], ["worker", WorkerLayout]] as const)("does not repeat guide recovery in the %s global header", async (role, Layout) => {
  state.role = role;
  const html = renderToStaticMarkup(await Layout({ children: <p>Task</p> }));
  expect(html).not.toContain("#workspace-guide");
  state.role = "unmatched";
  const other = renderToStaticMarkup(await Layout({ children: <p>Task</p> }));
  expect(other).not.toContain("#workspace-guide");
  state.role = "coach";
});
