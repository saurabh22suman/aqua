// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => [] }));
vi.mock("@/components/staff-invite-form", () => ({ StaffInviteForm: () => null }));
import StaffInvitePage from "@/app/(owner)/owner/staff/invitations/new/page";
afterEach(cleanup);
it("explains the actual all-locations default and how to restrict it before creating access", async () => {
  render(await StaffInvitePage());
  expect(screen.getByText(/leaving.*unselected.*all locations in this academy/i)).toBeTruthy();
  expect(screen.getByText(/select.*locations.*restrict/i)).toBeTruthy();
  expect(screen.queryByText(/explicit location scope/i)).toBeNull();
});
