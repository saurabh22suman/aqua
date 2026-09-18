// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-09 — the manual-initials chips on the staff board and the coach
// roster are replaced by PersonAvatar seeded with the stable person /
// member id. Asserting the seed attribute (not the display name) is
// the point: a rename must not repaint the avatar.

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

import { StaffBoard } from "@/components/staff-board";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import type { StaffRow } from "@/lib/services/staff";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";

afterEach(cleanup);

describe("U-09 avatar swap", () => {
  it("staff board renders a person avatar seeded by personId, not initials", () => {
    const rows = [
      {
        id: "s1",
        personId: "person-1",
        fullName: "Asha Rao",
        userId: null,
        staffType: "coach",
        employedOn: null,
      },
      {
        id: "s2",
        personId: "person-2",
        fullName: "Vikram Nair",
        userId: "u1",
        staffType: "receptionist",
        employedOn: "2026-01-01",
      },
    ] as unknown as StaffRow[];

    render(<StaffBoard rows={rows} />);

    const avatars = document.querySelectorAll('[data-testid="person-avatar"]');
    expect(avatars).toHaveLength(2);
    expect(
      document.querySelector('[data-avatar-seed="person-1"]'),
      "the seed must be the stable person id",
    ).toBeTruthy();
    expect(document.querySelector('[data-avatar-seed="person-2"]')).toBeTruthy();
  });

  it("coach members list renders an avatar seeded by memberId per row", () => {
    const roster = [
      {
        memberId: "member-1",
        name: "Aarav Sharma",
        code: "AWS-001",
        batches: ["Junior TTS"],
        isMinor: true,
      },
      {
        memberId: "member-2",
        name: "Diya Patel",
        code: "AWS-002",
        batches: ["Senior Squad"],
        isMinor: false,
      },
    ] as CoachRosterRow[];

    render(<CoachRosterSearch roster={roster} />);

    expect(screen.getAllByTestId("person-avatar")).toHaveLength(2);
    expect(document.querySelector('[data-avatar-seed="member-1"]')).toBeTruthy();
    expect(document.querySelector('[data-avatar-seed="member-2"]')).toBeTruthy();
    expect(screen.getAllByTestId("coach-roster-row")).toHaveLength(2);
  });
});
