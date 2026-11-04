// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — person avatars are the person's NAME INITIALS.
//
// Human steering (2 November 2026): "also for user profile … please use
// the name initials only, like others". The generated/gradient art is
// superseded: every person avatar draws the displayed name's initials,
// the same convention the member chips, the member profile and the staff
// detail already use — the first two non-empty name words, or the first
// grapheme of a single name, or "?" when there is no name at all (never a
// fabricated identity).
//
// The three owner/coach/reception consumers pass the displayed name that
// is already on the row. The stable id stays only as identity metadata
// for the existing checks; it no longer drives what is drawn.
//
// RED PROVENANCE: written before the source edit. The old primitive had
// no name at all (it generated SVG art from a seed), so every initials
// assertion below failed on the rendered output, not on an import.

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

const getRosterAction = vi.fn();
const markAttendanceSessionAction = vi.fn();

vi.mock("@/lib/actions/coach", () => ({
  getRosterAction: (...args: unknown[]) => getRosterAction(...args),
  markAttendanceSessionAction: (...args: unknown[]) =>
    markAttendanceSessionAction(...args),
}));

import { PersonAvatar, personInitials } from "@/components/avatar";
import { StaffBoard } from "@/components/staff-board";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import { ReceptionCheckIns } from "@/components/reception-check-ins";
import type { StaffRow } from "@/lib/services/staff";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";
import type { TodaySession, RosterRow } from "@/lib/actions/coach";

afterEach(() => {
  cleanup();
  getRosterAction.mockReset();
  markAttendanceSessionAction.mockReset();
});

function avatarText(): string {
  return screen.getByTestId("person-avatar").textContent?.trim() ?? "";
}

describe("PersonAvatar — the displayed name's initials", () => {
  it("draws two initials and no generated art", () => {
    const { container } = render(<PersonAvatar name="Asha Rao" />);

    expect(avatarText()).toBe("AR");
    // No generated SVG, no gradient art: the avatar is flat initials.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("linearGradient")).toBeNull();
  });

  it("uses the first two non-empty words", () => {
    render(<PersonAvatar name="  Asha   Venkata   Rao  " />);
    expect(avatarText()).toBe("AV");
  });

  it("uses the first grapheme of a single name", () => {
    const single = render(<PersonAvatar name="Madonna" />);
    expect(single.container.textContent?.trim()).toBe("M");
    cleanup();
    const accented = render(<PersonAvatar name="Émile" />);
    expect(accented.container.textContent?.trim()).toBe("É");
  });

  it("is Unicode safe at the start of a name", () => {
    // A surrogate pair is TWO UTF-16 code units; the first GRAPHEME must
    // not be split in half.
    render(<PersonAvatar name="🌟 Nova" />);
    expect(avatarText()).toBe("🌟N");
  });

  it("keeps a DECOMPOSED accent whole", () => {
    // "é" written as e + U+0301 is ONE grapheme and TWO code points. A
    // code-point slice would drop the accent and show "EZ".
    render(<PersonAvatar name={"e\u0301mile zola"} />);
    expect(avatarText()).toBe("E\u0301Z");
  });

  it("keeps an Indian-script grapheme whole", () => {
    // A base consonant keeps its vowel sign / conjunct: "मीरा सिंह" is
    // मी + सिं, never म + स; the conjunct क्ष is one grapheme, never a
    // bare क.
    expect(personInitials("मीरा सिंह")).toBe("मीसिं");
    const conjunct = personInitials("क्षमा वर्मा");
    expect(conjunct.startsWith("क")).toBe(true);
    expect(
      Array.from(conjunct).length,
      "a conjunct initial must keep its marks, not a bare consonant",
    ).toBeGreaterThan(2);
  });

  it("never invents an identity for an empty name", () => {
    const blank = render(<PersonAvatar name="   " />);
    expect(blank.container.textContent?.trim()).toBe("?");
    cleanup();
    const missing = render(<PersonAvatar name="" />);
    expect(missing.container.textContent?.trim()).toBe("?");
  });

  it("keeps the accessible contract: named when labelled, decorative otherwise", () => {
    const named = render(<PersonAvatar name="Asha Rao" label="Asha Rao" />);
    const image = named.container.querySelector('[data-testid="person-avatar"]');
    expect(image?.getAttribute("role")).toBe("img");
    expect(image?.getAttribute("aria-label")).toBe("Asha Rao");
    expect(image?.getAttribute("aria-hidden")).toBeNull();
    cleanup();
    const decorative = render(<PersonAvatar name="Asha Rao" />);
    const silent = decorative.container.querySelector('[data-testid="person-avatar"]');
    expect(silent?.getAttribute("aria-hidden")).toBe("true");
    expect(silent?.getAttribute("role")).toBeNull();
  });

  it("keeps the size, the square option and the caller's class", () => {
    const round = render(
      <PersonAvatar name="Asha Rao" size={36} className="flex-none" />,
    );
    const box = round.container.querySelector('[data-testid="person-avatar"]') as HTMLElement;
    expect(box.getAttribute("class")).toContain("flex-none");
    expect(box.getAttribute("class")).toContain("rounded-full");
    expect(box.style.width).toBe("36px");
    expect(box.style.height).toBe("36px");
    cleanup();
    const square = render(<PersonAvatar name="Asha Rao" size={32} square />);
    const squareBox = square.container.querySelector('[data-testid="person-avatar"]') as HTMLElement;
    expect(squareBox.getAttribute("class")).toContain("rounded-none");
    expect(squareBox.style.width).toBe("32px");
  });

  it("keeps the stable seed as identity metadata only", () => {
    // Two people with the SAME name but different ids draw the SAME
    // initials: the seed no longer drives the art.
    const first = render(<PersonAvatar name="Asha Rao" seed="person-1" />);
    expect(first.container.textContent?.trim()).toBe("AR");
    const seed = first.container.querySelector('[data-avatar-seed]');
    expect(seed?.getAttribute("data-avatar-seed")).toBe("person-1");
    cleanup();
    const second = render(<PersonAvatar name="Asha Rao" seed="person-9" />);
    expect(second.container.textContent?.trim()).toBe("AR");
  });
});

describe("the consumers draw the name they already show", () => {
  it("staff board: both responsive surfaces show the initials", () => {
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

    const table = screen.getByRole("table", { name: "Team directory" });
    const phoneList = screen.getByTestId("staff-list").querySelector("ul") as HTMLElement;
    const avatars = (surface: HTMLElement) =>
      Array.from(surface.querySelectorAll('[data-testid="person-avatar"]')).map(
        (avatar) => avatar.textContent?.trim(),
      );

    expect(avatars(table)).toEqual(["AR", "VN"]);
    expect(avatars(phoneList)).toEqual(["AR", "VN"]);
    // The stable identity metadata and the row link are preserved: the
    // avatar sits inside the row's own link to the person.
    expect(document.querySelectorAll('[data-avatar-seed="person-1"]')).toHaveLength(2);
    const firstAvatar = table.querySelector('[data-testid="person-avatar"]');
    expect(firstAvatar?.closest("a")?.getAttribute("href")).toBe(
      "/owner/staff/s1",
    );
  });

  it("coach roster: the initials come from the member name, links intact", () => {
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

    const rows = screen.getAllByTestId("coach-roster-row");
    expect(
      rows.map((row) =>
        row.querySelector('[data-testid="person-avatar"]')?.textContent?.trim(),
      ),
    ).toEqual(["AS", "DP"]);
    expect(rows[0]?.getAttribute("href")).toBe("/coach/members/member-1");
    expect(document.querySelector('[data-avatar-seed="member-1"]')).toBeTruthy();
  });

  it("reception check-ins: the roster rows show the initials", async () => {
    const session: TodaySession = {
      id: "s1",
      batchName: "Junior TTS",
      startsAt: "2026-09-12T01:30:00.000Z",
      endsAt: "2026-09-12T02:30:00.000Z",
      marked: 1,
      total: 2,
    };
    const rows: RosterRow[] = [
      {
        memberId: "m1",
        name: "Aarav Sharma",
        code: "AWS-001",
        status: "present",
        markedAt: "2026-09-12T01:12:00.000Z",
        pct: 100,
        isTrial: false,
      },
      {
        memberId: "m2",
        name: "Diya Patel",
        code: "AWS-002",
        status: null,
        markedAt: null,
        pct: null,
        isTrial: false,
      },
    ];
    getRosterAction.mockResolvedValue({
      batchName: "Junior TTS",
      startsAt: session.startsAt,
      offlineSyncEnabled: false,
      rows,
    });
    markAttendanceSessionAction.mockResolvedValue({ ok: true });

    render(<ReceptionCheckIns sessions={[session]} canMark />);
    fireEvent.click(screen.getByTestId("checkin-session-s1"));

    await screen.findByText("Aarav Sharma");
    const avatars = Array.from(
      document.querySelectorAll('[data-testid="person-avatar"]'),
    ).map((avatar) => avatar.textContent?.trim());
    expect(avatars).toEqual(["AS", "DP"]);
    expect(document.querySelector('[data-avatar-seed="m1"]')).toBeTruthy();
    expect(screen.getByText("Diya Patel")).toBeTruthy();
  });
});
