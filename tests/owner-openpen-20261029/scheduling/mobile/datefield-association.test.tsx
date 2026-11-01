// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Mobile v2 association check for the scheduling lane's only DateField
// caller. The reschedule form cannot be saved without a date, so the
// field must expose that requirement to assistive technology; the
// shared DateField now forwards `required`/`aria-required`.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/session-lifecycle", () => ({
  cancelSessionAction: vi.fn(),
  rescheduleSessionAction: vi.fn(),
}));

import { SessionLifecycleControl } from "@/components/session-lifecycle-control";

afterEach(cleanup);

it("marks the reschedule date as required and keeps its format guidance associated", () => {
  render(
    <SessionLifecycleControl
      sessionId="s1"
      sessionDate="2026-10-29"
      startWall="07:00"
      endWall="08:00"
      status="scheduled"
      onChanged={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByTestId("reschedule-open-s1"));
  const date = screen.getByTestId("reschedule-date");

  expect(date.getAttribute("aria-required")).toBe("true");
  expect(date.getAttribute("aria-describedby")).toContain(
    "reschedule-date-format",
  );
});
