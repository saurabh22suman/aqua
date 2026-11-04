// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Select } from "@/components/ui/Select";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reveals the active option inside its bounded list without scrolling an ancestor", () => {
  const nativeScroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: nativeScroll });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="listbox"]') as HTMLElement | null;
    const index = this.getAttribute("role") === "option" ? Number(this.textContent) : 0;
    const top = this.getAttribute("role") === "option" ? 100 + index * 44 - (list?.scrollTop ?? 0) : 100;
    const height = this.getAttribute("role") === "listbox" ? 100 : 44;
    return { top, bottom: top + height, left: 0, right: 120, width: 120, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  render(<div style={{ overflowY: "auto" }}><Select aria-label="Year" defaultValue="20">{Array.from({ length: 30 }, (_, i) => <option key={i} value={i}>{i}</option>)}</Select></div>);
  fireEvent.keyDown(screen.getByLabelText("Year"), { key: "ArrowDown" });
  const list = screen.getByRole("listbox");
  expect(list.style.maxHeight).not.toBe("");
  expect(nativeScroll).not.toHaveBeenCalled();
  expect(list.scrollTop).toBeGreaterThan(0);
  const option = within(list).getByRole("option", { name: "20" });
  expect(option.getBoundingClientRect().bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom);
});
