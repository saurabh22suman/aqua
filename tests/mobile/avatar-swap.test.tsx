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

    // StaffBoard deliberately renders two responsive surfaces: an aligned
    // desktop table (hidden below md) and an identity-first phone list
    // (hidden from md). CSS exposes exactly one at a time, so the obsolete
    // whole-DOM count of 2 saw the same two people twice. Assert each
    // surface separately and keep the seed (not name) contract.
    const table = screen.getByRole("table", { name: "Team directory" });
    const phoneList = screen.getByTestId("staff-list").querySelector("ul");
    expect(phoneList).not.toBeNull();

    for (const surface of [table, phoneList as HTMLElement]) {
      const avatars = surface.querySelectorAll(
        '[data-testid="person-avatar"]',
      );
      expect(avatars).toHaveLength(2);
      for (const avatar of Array.from(avatars)) {
        expect(avatar.getAttribute("data-avatar-seed")).toBeTruthy();
      }
    }

    expect(
      document.querySelectorAll('[data-avatar-seed="person-1"]'),
      "the seed must be the stable person id on both responsive surfaces",
    ).toHaveLength(2);
    expect(
      document.querySelectorAll('[data-avatar-seed="person-2"]'),
    ).toHaveLength(2);
    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vikram Nair").length).toBeGreaterThan(0);
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
