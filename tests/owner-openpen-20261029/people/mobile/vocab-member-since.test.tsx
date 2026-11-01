// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Preset vocabulary follows the tenant's closed-key member term in the
// compact directory; joined dates belong to the member profile.

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";

const MEMBER = {
  memberId: "m1",
  personId: "p1",
  fullName: "Aanya Rao",
  phone: "+919000000101",
  memberCode: "AAC-001",
  status: "active",
  locationId: "loc-1",
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-10T04:00:00.000Z",
  joinedOn: "2026-10-10",
} as MemberListRow;

afterEach(cleanup);

describe("directory preset vocabulary", () => {
  it("uses the swim preset's swimmer term while retaining the member details", () => {
    render(
      <MembersBoard
        initialMembers={[MEMBER]}
        terminology={{
          overrides: { member: { en: { one: "swimmer", other: "swimmers" } } },
          locale: "en",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Swimmer directory" })).toBeTruthy();
    const row = screen.getByTestId("member-row");
    expect(row.textContent).toContain("Aanya Rao");
    expect(row.textContent).toContain("AAC-001 · Worli Main");
    expect(row.textContent).toContain("+91 90000 00101");
    expect(row.textContent).toContain("Active");
    expect(row.getAttribute("href")).toBe("/owner/members/m1");
    expect(document.body.textContent).not.toContain("Member since");
  });
});
