// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Preset vocabulary — the directory's "member since" heading and phone label
// must follow the tenant's closed-key member term, not a hardcoded word.

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

describe("member-since preset vocabulary", () => {
  it("uses the swim preset's swimmer term in the heading and phone label", () => {
    render(
      <MembersBoard
        initialMembers={[MEMBER]}
        terminology={{
          overrides: { member: { en: { one: "swimmer", other: "swimmers" } } },
          locale: "en",
        }}
      />,
    );

    expect(screen.getAllByText("Swimmer since").length).toBeGreaterThan(0);
    expect(screen.getByText("Swimmer")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Member since");
  });
});
