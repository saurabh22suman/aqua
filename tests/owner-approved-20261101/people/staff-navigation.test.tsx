// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const grants = vi.hoisted(() => ({ permissions: new Set(["staff.read", "staff.roster"]) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ roleKey: "admin", tenantId: "tenant-1", userId: "user-1", permissions: grants.permissions, features: new Set(["staff"]) }), requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => { if (!ctx.permissions.has(key)) throw new Error("forbidden"); } }));
vi.mock("@/lib/actions/staff", () => ({ listStaffAction: async () => [{ id: "staff-1", personId: "p-1", fullName: "Test Person", staffType: "coach", userId: null, employedOn: null }] }));
vi.mock("@/lib/actions/tenant-owner-reset", () => ({ listOwnerMembershipsAction: async () => [] }));
vi.mock("@/components/owner-reset-links", () => ({ OwnerResetLinks: () => null }));
import StaffListPage from "@/app/(owner)/owner/staff/page";
afterEach(() => { cleanup(); grants.permissions = new Set(["staff.read", "staff.roster"]); });
// The approved Staff "Shortcuts" layout (human choice, 3 Nov 2026) removed
// the DUPLICATE check-in QR from the directory root: the real destination is
// the roster page's "Check-in poster" link, which requires staff.roster. The
// directory's own destinations and profile access are unchanged.
it("keeps roster, invitations and leave reachable, and profile access, without duplicating check-in QR", async () => {
  render(await StaffListPage());
  expect(screen.getByRole("link", { name: "Roster" }).getAttribute("href")).toBe("/owner/staff/roster");
  expect(screen.getByRole("link", { name: "Invitations" }).getAttribute("href")).toBe("/owner/staff/invitations");
  expect(screen.getByRole("link", { name: "Leave" }).getAttribute("href")).toBe("/owner/staff/leave");
  expect(screen.queryByRole("link", { name: /check-in/i })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Test Person" }).getAttribute("href")).toBe("/owner/staff/staff-1");
});
it("never duplicates check-in QR at the directory root, with or without roster permission", async () => {
  render(await StaffListPage());
  expect(screen.queryByRole("link", { name: /check-in/i })).toBeNull();
  cleanup();
  grants.permissions = new Set(["staff.read"]);
  render(await StaffListPage());
  expect(screen.queryByRole("link", { name: /check-in/i })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Test Person" }).getAttribute("href")).toBe("/owner/staff/staff-1");
});

it("does not repeat the roster, invitations and leave navigation in the staff introduction", async () => {
  render(await StaffListPage());
  expect(screen.queryByText(/roster, invitations and leave are managed separately/i)).toBeNull();
  expect(screen.getByRole("link", { name: "Roster" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Invitations" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Leave" })).toBeTruthy();
});
