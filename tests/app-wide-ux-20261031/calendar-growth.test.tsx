// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DateCalendar } from "@/components/ui/DateCalendar";
import { calendarPopupLayout } from "@/components/ui/calendar-viewport";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("grows from a short month to a six-week month when the viewport has room", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") !== "dialog") return 0;
    const natural = this.querySelector('[aria-label="March 2026"]') ? 400 : 320;
    return Math.min(natural, Number.parseFloat(this.style.maxHeight) || natural);
  });
  render(<DateCalendar id="growth" value="2026-02-15" todayIso="2026-02-15" onSelect={() => {}} onDismiss={() => {}} anchor={{ top: 10, bottom: 40, left: 10 }} />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.offsetHeight).toBe(320);
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByRole("grid", { name: "March 2026" })).toBeTruthy();
  expect(dialog.offsetHeight).toBe(400);
});

it("keeps room for growing content without exceeding the viewport", () => {
  const layout = calendarPopupLayout({ top: 500, bottom: 540, left: 8 }, 390, { width: 360, height: 667 });
  expect(layout.maxHeight).toBe(651);
  expect(Math.min(424, layout.maxHeight)).toBe(424);
  const short = calendarPopupLayout({ top: 180, bottom: 220, left: 8 }, 424, { width: 360, height: 300 });
  expect(short.maxHeight).toBe(284);
  expect(short.top).toBeGreaterThanOrEqual(8);
});
