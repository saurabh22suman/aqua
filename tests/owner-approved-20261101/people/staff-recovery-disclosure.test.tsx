// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ roleKey: state.role, permissions: new Set(["staff.read"]) }), requirePagePermission: vi.fn() }));
vi.mock("@/lib/actions/staff", () => ({ listStaffAction: async () => [] }));
vi.mock("@/lib/actions/tenant-owner-reset", () => ({ listOwnerMembershipsAction: async () => [{ id: "owner-1" }] }));
vi.mock("@/components/owner-reset-links", () => ({ OwnerResetLinks: () => <p>Owner recovery controls</p> }));
import StaffListPage from "@/app/(owner)/owner/staff/page";
afterEach(() => { cleanup(); state.role = "owner"; });

it("keeps owner recovery available in a closed disclosure below the directory", async () => {
  render(await StaffListPage());
  const disclosure = screen.getByText("Owner recovery controls").closest("details");
  expect(disclosure).not.toBeNull();
  expect(disclosure?.open).toBe(false);
  expect(disclosure?.querySelector("summary")?.textContent).toMatch(/owner.*recovery/i);
});

it("does not expose recovery to an admin", async () => {
  state.role = "admin";
  render(await StaffListPage());
  expect(screen.queryByText("Owner recovery controls")).toBeNull();
});
