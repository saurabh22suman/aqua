// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/staff-invitations", () => ({ revokeInvitationAction: vi.fn(), reactivateInvitationAction: vi.fn() }));
vi.mock("@/lib/actions/invite-link", () => ({ issueLoginLinkAction: vi.fn() }));
vi.mock("@/components/link-qr", () => ({ LinkQr: () => null }));
import { InvitationsBoard } from "@/components/invitations-board";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";
afterEach(cleanup);
const row = { membershipId: "11111111-1111-4111-8111-111111111111", phone: "+919000000001", fullName: "Test manager", status: "active" as const, roleKey: "manager", locationNames: [], invitedAt: null };

it.each([
  [false, [], "No clubs assigned"],
  [true, [], "All clubs, including future clubs"],
  [false, ["MP18"], "MP18"],
  [true, ["MP18"], "All clubs, including future clubs"],
] as const)("describes access using the authoritative flag %s and club names %j", (allLocations, names, label) => {
  const item: ListInvitationsRow & { allLocations: boolean } = { ...row, allLocations, locationNames: [...names] };
  render(<InvitationsBoard rows={[item]} />);
  expect(screen.getByText(label)).toBeTruthy();
  if (!allLocations) expect(screen.queryByText(/all locations|all clubs/i)).toBeNull();
});
