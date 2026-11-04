// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the member row's
// metadata on a phone.
//
// Actual Chrome r4 RED (combined integration, 390px, before these source
// changes): a formatted phone number broke across two lines —
// "+91 98123" / "40099" — because the member code, the facility and the
// phone shared ONE wrapping text run.
//
// The rendered contract: the phone is its OWN group and may not break
// inside it, while the groups themselves may wrap. Chrome measures the
// fit; this file proves the structure that lets the browser do it.
//
// No database: the board's only server action is stubbed.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";

// The phone from the measured capture: "+91 98123 40099".
const PHONE = "+919812340099";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Chandrashekhar Balasubramanian Iyer",
  phone: PHONE,
  memberCode: "M-01",
  status: "active",
  locationId: "loc-1",
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW]);
});

afterEach(() => {
  cleanup();
});

describe("the member row's metadata", () => {
  // RED: the phone shares one wrapping text run with the code and the
  // facility, so the browser breaks the number in half.
  it("keeps a formatted phone as one atomic group", () => {
    render(<MembersBoard initialMembers={[ROW]} navigationNamespace="t:u" />);
    const meta = screen.getByTestId("member-row-meta");
    const phone = within(meta).getByTestId("member-row-phone");

    // The group holds the phone and nothing else.
    expect(phone.textContent?.trim()).toBe("+91 98123 40099");
    // It may not break inside itself.
    expect(phone.className).toContain("whitespace-nowrap");
    // The other facts are a SEPARATE group, so the groups can wrap
    // between them.
    const groups = Array.from(meta.querySelectorAll("*")).filter(
      (element) => element.textContent?.trim() === "M-01 · Worli Main",
    );
    expect(groups).toHaveLength(1);
    expect(phone.parentElement).toBe(meta);
  });

  // CONTROL: the facts, their order and their format are unchanged.
  it("keeps the code, the facility and the phone readable", () => {
    render(<MembersBoard initialMembers={[ROW]} navigationNamespace="t:u" />);
    const row = screen.getByTestId("member-row");
    expect(row.textContent).toContain("Chandrashekhar Balasubramanian Iyer");
    expect(row.textContent).toContain("M-01 · Worli Main");
    expect(row.textContent).toContain("+91 98123 40099");
    expect(row.textContent).toContain("Active");
    expect(row.getAttribute("href")).toBe(
      `/owner/members/${ROW.memberId}?facility=all`,
    );
  });
});
