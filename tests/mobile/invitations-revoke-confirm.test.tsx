// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — revoking access is a named,
// consequence-aware confirmation bound to the selected row. Cancel
// performs no mutation; a failed revoke keeps the confirmation open
// for retry; the persisted state is reflected after success.

const revokeInvitationAction = vi.hoisted(() => vi.fn());
const reactivateInvitationAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/staff-invitations", () => ({
  revokeInvitationAction,
  reactivateInvitationAction,
}));
vi.mock("@/lib/actions/invite-link", () => ({
  issueLoginLinkAction: vi.fn(),
}));
vi.mock("@/components/link-qr", () => ({ LinkQr: () => null }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { InvitationsBoard } from "@/components/invitations-board";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

const ROW: ListInvitationsRow = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  phone: "+919000000001",
  status: "active",
  roleKey: "coach",
  locationNames: ["Worli"],
} as ListInvitationsRow;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InvitationsBoard revoke confirmation (P1)", () => {
  it("requires a confirmation that names the person, role and scope", () => {
    render(<InvitationsBoard rows={[ROW]} />);
    fireEvent.click(screen.getByTestId(`revoke-${ROW.membershipId}`));

    expect(revokeInvitationAction).not.toHaveBeenCalled();
    const panel = screen.getByText(/Revoke access for \+91 90000 00001\?/);
    expect(panel).toBeTruthy();
    expect(document.body.textContent).toContain("coach");
    expect(document.body.textContent).toContain("Worli");
    expect(document.body.textContent).toMatch(/stop working/);
  });

  it("cancel performs no mutation and dismisses the confirmation", () => {
    render(<InvitationsBoard rows={[ROW]} />);
    fireEvent.click(screen.getByTestId(`revoke-${ROW.membershipId}`));
    fireEvent.click(screen.getByRole("button", { name: /keep access/i }));

    expect(revokeInvitationAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/Revoke access for/)).toBeNull();
  });

  it("keeps the confirmation open with an error when revocation fails", async () => {
    revokeInvitationAction.mockResolvedValue({
      kind: "error",
      code: "would_leave_zero_owners",
      message: "Revoking the only active owner would lock the tenant out.",
    });
    render(<InvitationsBoard rows={[ROW]} />);
    fireEvent.click(screen.getByTestId(`revoke-${ROW.membershipId}`));
    fireEvent.click(screen.getByTestId(`revoke-confirm-${ROW.membershipId}`));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/lock the tenant out/i),
    );
    expect(screen.getByTestId(`revoke-confirm-${ROW.membershipId}`)).toBeTruthy();
  });

  it("refreshes the server list after a successful revocation", async () => {
    revokeInvitationAction.mockResolvedValue({
      kind: "ok",
      revokedAt: new Date(),
    });
    render(<InvitationsBoard rows={[ROW]} />);
    fireEvent.click(screen.getByTestId(`revoke-${ROW.membershipId}`));
    fireEvent.click(screen.getByTestId(`revoke-confirm-${ROW.membershipId}`));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/Revoke access for/)).toBeNull();
  });
});
