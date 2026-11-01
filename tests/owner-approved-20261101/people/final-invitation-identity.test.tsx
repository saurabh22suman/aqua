// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/staff-invitations", () => ({ revokeInvitationAction: vi.fn(), reactivateInvitationAction: vi.fn() }));
vi.mock("@/lib/actions/invite-link", () => ({ issueLoginLinkAction: vi.fn() }));
import { InvitationsBoard } from "@/components/invitations-board";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";
afterEach(cleanup);
const row = { membershipId: "m1", phone: "+919000000101", fullName: "", roleKey: "coach", status: "invited", locationNames: [], invitedAt: null } as ListInvitationsRow;
it.each(["", "+919000000101", "+91 90000 00101"])("shows the phone once when the title is the same phone: %s", (fullName) => {
  render(<InvitationsBoard rows={[{ ...row, fullName }]} />);
  expect(screen.getAllByText(/\+91\s*90000\s*00101/)).toHaveLength(1);
});
it("retains both a real name and the phone", () => {
  render(<InvitationsBoard rows={[{ ...row, fullName: "Aanya Rao" }]} />);
  expect(screen.getByText("Aanya Rao")).toBeTruthy();
  expect(screen.getByText("+91 90000 00101")).toBeTruthy();
});
