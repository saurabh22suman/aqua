// @vitest-environment jsdom
//
// Owner light · Operations lane (3 November 2026) — the four operations
// loading routes.
//
// The shared skeleton is aria-hidden, so a cold load of the schedule, the
// sessions list, the booking desk or the programs board announced NOTHING to
// a screen reader. These cases render the REAL loading routes and assert that
// each announces its own surface.
//
// The control is the geometry: the skeleton blocks stay exactly as they are
// (the same count of aria-hidden placeholders, in the same places) and the
// announcement carries no data of its own — no fake rows, no invented numbers.
//
// Owner: operations lane
// Scope: the four operations loading routes.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ScheduleLoading from "@/app/(owner)/owner/schedule/loading";
import SessionsLoading from "@/app/(owner)/owner/sessions/loading";
import BookingsLoading from "@/app/(owner)/owner/bookings/loading";
import ProgramsLoading from "@/app/(owner)/owner/programs/loading";

afterEach(cleanup);

/**
 * The skeleton geometry each route had before this change: the number of
 * aria-hidden placeholders its skeleton renders. The announcement must not
 * add, remove or replace one of them.
 */
const SKELETONS = {
  schedule: 20,
  sessions: 15,
  bookings: 14,
  programs: 25,
} as const;

const ROUTES: ReadonlyArray<{
  surface: keyof typeof SKELETONS;
  Component: () => React.JSX.Element;
  names: RegExp;
}> = [
  {
    surface: "schedule",
    Component: ScheduleLoading,
    names: /schedule/i,
  },
  {
    surface: "sessions",
    Component: SessionsLoading,
    names: /sessions/i,
  },
  {
    surface: "bookings",
    Component: BookingsLoading,
    names: /bookings/i,
  },
  {
    surface: "programs",
    Component: ProgramsLoading,
    names: /programs/i,
  },
];

describe("INTENDED RED — each operations loading route announces its surface", () => {
  for (const route of ROUTES) {
    it(`announces the ${route.surface} surface while it loads`, () => {
      const { container } = render(<route.Component />);

      const status = screen.getByRole("status");
      expect(status.textContent ?? "").toMatch(route.names);
      // Visually hidden, but never hidden from assistive technology.
      expect(status.className).toMatch(/sr-only/);
      expect(status.getAttribute("aria-hidden")).toBeNull();
      expect(status.closest("[aria-hidden='true']")).toBeNull();

      // The skeleton geometry is untouched and the announcement invents no
      // data of its own.
      const skeletons = container.querySelectorAll("[aria-hidden='true']");
      expect(skeletons).toHaveLength(SKELETONS[route.surface]);
      expect(status.textContent ?? "").not.toMatch(/\d/);
    });
  }
});
