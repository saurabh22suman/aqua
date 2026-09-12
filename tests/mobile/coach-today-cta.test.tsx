// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 5 (mobile UX plan v2) — F21. The "Up next" card had an
// obvious "Open register →" CTA while the today-session card had no
// CTA at all, so the highest-frequency action (mark today's register)
// looked less tappable than a future one. Both states now carry the
// same CTA.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireCoach: async () => ({}),
}));
vi.mock("@/lib/actions/coach", () => ({
  getCoachHomeAction: async () => ({
    sessions: [
      {
        id: "s1",
        startsAt: new Date("2026-09-12T11:30:00.000Z"),
        batchName: "Junior TTS",
        marked: 2,
        total: 10,
      },
    ],
    next: null,
  }),
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

import CoachHomePage from "@/app/(coach)/coach/page";

afterEach(cleanup);

describe("coach today card CTA (F21)", () => {
  it("shows an Open register CTA on today's session card", async () => {
    render(await CoachHomePage());

    const card = screen.getByTestId("coach-today-session");
    expect(card.textContent).toContain("Open register");
    expect(card.textContent).toContain("05:00 pm");
  });
});
