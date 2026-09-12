// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 4 (mobile UX plan v2) — F29. The schedule header printed
// "Sat · Sat, 12 Sept" because it prefixed DAY_LABELS[getUTCDay()] to
// a dateLabel that already contains the weekday. The test also pins
// the IST time on the session row (Phase 3 migration).

vi.mock("@/lib/auth/surface-guard", () => ({
  requireCoach: async () => ({}),
}));
vi.mock("@/lib/actions/coach", () => ({
  getScheduleAction: async () => ({
    days: [
      {
        date: "2026-09-12",
        sessions: [
          {
            id: "s1",
            startsAt: new Date("2026-09-12T11:30:00.000Z"),
            batchName: "Junior TTS",
            marked: 1,
            total: 10,
          },
        ],
      },
    ],
  }),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { children?: unknown }) =>
      React.createElement("a", null, props.children as React.ReactNode),
  };
});

import CoachSchedulePage from "@/app/(coach)/coach/schedule/page";

afterEach(cleanup);

describe("coach schedule header (F29)", () => {
  it("renders the weekday once and the IST time on the row", async () => {
    render(await CoachSchedulePage());

    const text = document.body.textContent ?? "";
    expect(text).toContain("Sat, 12 Sept");
    expect(text).not.toContain("Sat · Sat");
    expect(text).toContain("05:00 pm Junior TTS");
  });
});
