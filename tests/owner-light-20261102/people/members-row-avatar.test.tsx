// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the member row's initials.
//
// The directory drew its own initials with `part[0]` — the first UTF-16
// CODE UNIT of each word. That splits an Indian conjunct (क्षा → "क") and
// cuts a combining mark off its base letter ("E" + U+0301 → "E"), so the
// row showed something the person's name never said.
//
// The shared PersonAvatar already owns this: the first GRAPHEME of each of
// the first two words, on the theme's own surface, and no generated art,
// no photo and no upload.
//
// This file pins that the directory row uses THAT component and nothing
// else: the exact shared initials, the shared theme surface, and no
// image asset.
//
// No database: the board's only server action is stubbed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

import { MembersBoard } from "@/components/members-board";
import { personInitials } from "@/components/avatar";
import type { MemberListRow } from "@/lib/services/people";

function member(fullName: string, personId: string): MemberListRow {
  return {
    memberId: "11111111-1111-4111-8111-111111111111",
    personId,
    fullName,
    phone: null,
    memberCode: "M-01",
    status: "active",
    locationId: "loc-1",
    locationName: "Worli Main",
    isMinor: false,
    createdAt: "2026-10-01T00:00:00Z",
    joinedOn: "2026-10-01",
  };
}

// "क्षा लक्ष्मी" — the conjunct क्ष is one cluster, and "लक्ष्मी" starts
// with its own cluster ल.
const CONJUNCT_NAME = "क्षा लक्ष्मी";
// "E" + COMBINING ACUTE ACCENT + "milie Rao" — one grapheme, two code
// points.
const COMBINING_NAME = "E\u0301milie Rao";

function renderRow(fullName: string) {
  render(
    <MembersBoard
      initialMembers={[member(fullName, "person-1")]}
      navigationNamespace="tenant-1:user-1"
    />,
  );
  return screen.getByTestId("person-avatar");
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([]);
});

afterEach(cleanup);

describe("the member row's initials", () => {
  // RED: the row draws its own initials from a code unit.
  it("uses the shared person avatar", () => {
    const avatar = renderRow("Asha Rao");
    expect(avatar).toBeTruthy();
    expect(avatar.textContent).toBe(personInitials("Asha Rao"));
  });

  // RED: an Indian conjunct is cut in half by a code unit.
  it("keeps an Indian conjunct whole", () => {
    const avatar = renderRow(CONJUNCT_NAME);
    expect(avatar.textContent).toBe(personInitials(CONJUNCT_NAME));
    expect(avatar.textContent).not.toBe(
      CONJUNCT_NAME.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join(""),
    );
  });

  // RED: a combining mark is cut off its base letter by a code unit.
  it("keeps a combining mark on its base letter", () => {
    const avatar = renderRow(COMBINING_NAME);
    expect(avatar.textContent).toBe(personInitials(COMBINING_NAME));
    expect(avatar.textContent).toContain("\u0301");
  });

  // CONTROL: the shared theme surface, and no photo or generated art.
  it("draws the shared theme surface and no image", () => {
    const avatar = renderRow("Asha Rao");
    expect(avatar.className).toContain("bg-[var(--accent-soft)]");
    expect(avatar.className).toContain("text-[var(--accent-ink)]");
    expect(avatar.className).not.toContain("bg-deck");
    expect(avatar.querySelector("img")).toBeNull();
    expect(
      screen.getByTestId("member-row").querySelector("img"),
    ).toBeNull();
  });

  // CONTROL: the avatar stays decorative — the visible name beside it is
  // the identity — and carries the stable person id as metadata.
  it("stays decorative and keeps the person id as metadata", () => {
    const avatar = renderRow("Asha Rao");
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("data-avatar-seed")).toBe("person-1");
  });
});
