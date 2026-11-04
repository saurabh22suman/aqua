// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { clientViewport, calendarPopupLayout } from "@/components/ui/calendar-viewport";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([390, 320])("fits the client and visual viewport when visual width is %i", (visualWidth) => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(375);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(844);
  vi.stubGlobal("visualViewport", { width: visualWidth, height: 600 });
  const viewport = clientViewport();
  expect(viewport).toEqual({ width: Math.min(375, visualWidth), height: 600 });
  const layout = calendarPopupLayout({ top: 100, bottom: 148, left: 62 }, 370, viewport);
  expect(layout.left + layout.width).toBeLessThanOrEqual(viewport.width);
});
