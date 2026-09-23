// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// F5 (mobile UX plan v2, Phase 0) — reception's Today card linked to
// /coach/register/[sessionId], a coach-only page, so every tap in the
// receptionist's primary screen landed on a 404. The regression guard
// is still "no /coach/register href on /reception".
//
// U-08 moved the session cards into the Today's check-ins panel:
// reception now holds attendance.mark (lib/services/roles.ts), so the
// panel marks present directly instead of deferring to the coach. The
// operational data (batch name, counted figures) and the café entry
// point stay.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({
    permissions: new Set(["attendance.mark"]),
  }),
}));

const getTodayAction = vi.fn();
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/coach", () => ({
  getTodayAction: (...args: unknown[]) => getTodayAction(...args),
  getRosterAction: vi.fn(async () => null),
  markAttendanceSessionAction: vi.fn(async () => ({ ok: true })),
}));

import ReceptionTodayPage from "@/app/(reception)/reception/page";

const SESSIONS = [
  {
    id: "s1",
    startsAt: "2026-09-12T01:30:00.000Z",
    endsAt: "2026-09-12T02:30:00.000Z",
    batchName: "Junior TTS",
    marked: 2,
    total: 16,
  },
];

afterEach(() => {
  cleanup();
  getTodayAction.mockReset();
});

describe("ReceptionTodayPage — no coach link, check-ins panel present (F5, U-08)", () => {
  it("contains no /coach/register href and carries the day's check-in state", async () => {
    getTodayAction.mockResolvedValue({ sessions: SESSIONS });

    render(await ReceptionTodayPage());

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => h?.startsWith("/coach/register/"))).toBe(false);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Junior TTS");
    expect(text).toContain("2 / 16 checked in");
    expect(text).toContain("Today's check-ins");
  });

  it("links to the café counter (K-07 entry point)", async () => {
    getTodayAction.mockResolvedValue({ sessions: SESSIONS });

    render(await ReceptionTodayPage());

    expect(screen.getByTestId("cafe-link").getAttribute("href")).toBe(
      "/reception/cafe",
    );
  });

  it("offers no bookings path while booking pricing has no UI (PR1-C5)", async () => {
    getTodayAction.mockResolvedValue({ sessions: SESSIONS });

    render(await ReceptionTodayPage());

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => h?.startsWith("/reception/bookings"))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Reserve a lane or court/i);
  });
});
