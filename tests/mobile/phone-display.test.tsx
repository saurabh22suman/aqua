// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 3 (mobile UX plan v2) — Indian phone display at the member
// surfaces. Storage is a mix of E.164 and 10-digit local; the display
// always shows +91 98123 40010, while edits still commit the stored
// value unchanged (phone formatting must never round-trip into writes).

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(),
  updateMemberAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
import type { MemberListRow } from "@/lib/services/people";

function member(phone: string | null): MemberListRow {
  return {
    memberId: "m1",
    fullName: "Arjun Mehta",
    isMinor: false,
    memberCode: "AQUA-001",
    locationName: "Demo Main",
    phone,
    status: "active",
    createdAt: "2026-09-01T06:00:00.000Z",
    joinedOn: "2026-09-01",
  } as MemberListRow;
}

afterEach(cleanup);

describe("owner member list phone display", () => {
  it("renders E.164 and local numbers as +91 5+5", () => {
    render(<MembersBoard initialMembers={[member("+919812340010")]} />);
    // PR3-C4 — the responsive roster renders the phone in both the
    // phone-only inline line and the desktop column; either is the
    // formatted value this test pins.
    expect(screen.getAllByText(/\+91 98123 40010/).length).toBeGreaterThan(0);
  });

  it("formats a 10-digit local number", () => {
    render(<MembersBoard initialMembers={[member("9876500001")]} />);
    expect(screen.getAllByText(/\+91 98765 00001/).length).toBeGreaterThan(0);
  });
});

describe("inline edit phone field", () => {
  const SNAPSHOT = {
    fullName: "Arjun Mehta",
    dateOfBirth: "2015-01-01",
    locationId: "11111111-1111-1111-1111-111111111111",
    phone: "9876500001",
    gender: "male",
    medicalNotes: null,
  } as const;

  it("formats the read-only value but keeps the raw value when editing", () => {
    render(
      <InlineEditField
        value="9876500001"
        field="phone"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
        formatAs="phone"
      />,
    );

    expect(screen.getAllByText(/\+91 98765 00001/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("Edit phone number"));
    const input = screen.getByLabelText("phone number") as HTMLInputElement;
    expect(input.value).toBe("9876500001");
  });
});
