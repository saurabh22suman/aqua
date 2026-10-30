// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner invitations / check-in poster interiors — intended RED.
// Reference: identity (name, then phone) leads the invitation row; role and
// location scope are readable; one bounded surface carries the list.
// The poster keeps print controls outside the printed sheet, states the task
// and shows the readable fallback link.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/staff-invitations", () => ({
  revokeInvitationAction: vi.fn(),
  reactivateInvitationAction: vi.fn(),
}));
vi.mock("@/lib/actions/invite-link", () => ({
  issueLoginLinkAction: vi.fn(),
}));

import { InvitationsBoard } from "@/components/invitations-board";
import { PremisesQrCard } from "@/components/premises-qr-card";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

const ROW = {
  membershipId: "m1",
  phone: "+919000000101",
  fullName: "Aanya Rao",
  roleKey: "coach",
  status: "invited",
  locationNames: ["Worli Main"],
  invitedAt: null,
} as unknown as ListInvitationsRow;

afterEach(cleanup);

describe("invitation list interior", () => {
  it("leads with the person, then phone, role, scope and state", () => {
    render(<InvitationsBoard rows={[ROW]} />);

    const surface = screen.getByTestId("invitations-surface");
    const head = screen.getByTestId("invitations-head");
    expect(surface.contains(head)).toBe(true);
    expect(head.textContent).toContain("Person");
    expect(head.textContent).toContain("Role");
    expect(head.textContent).toContain("Location access");
    expect(head.textContent).toContain("State");

    const text = surface.textContent ?? "";
    expect(text.indexOf("Aanya Rao")).toBeLessThan(text.indexOf("+91 90000 00101"));
    expect(text).toContain("Coach");
    expect(text).toContain("Worli Main");
    expect(text).toContain("Invited");
  });

  it("keeps one contextual sign-in action for an invited row", () => {
    render(<InvitationsBoard rows={[ROW]} />);
    expect(
      screen.getByRole("button", { name: /generate sign-in link/i }),
    ).toBeTruthy();
  });
});

describe("check-in poster interior", () => {
  it("keeps print controls outside the poster and shows the fallback link", () => {
    render(<PremisesQrCard urlPath="/check-in/synthetic-relative-token" />);

    const poster = screen.getByTestId("premises-qr-poster");
    const print = screen.getByRole("button", { name: /print poster/i });
    expect(poster.contains(print)).toBe(false);
    expect(poster.textContent).toContain("Staff check-in");
    expect(poster.textContent).toContain("Scan the academy");
    expect(poster.textContent).toContain("/check-in/synthetic-relative-token");
  });
});
