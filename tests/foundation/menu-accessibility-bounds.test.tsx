// @vitest-environment jsdom
//
// Menu bounds — the review follow-up.
//
// The first pass measured the menu's bounds only when it opened. An
// open menu therefore kept a stale size when the window was resized,
// the phone keyboard shrank the visual viewport, the page scrolled the
// trigger out of view, or the menu sat inside a scrolling column that
// clipped it.
//
// These tests drive the real geometry (the rendered max-height and
// max-width the component writes on the menu element) and the real
// interactions (the menu opening, closing and re-measuring), not the
// class strings. Agent-owned file: tests/foundation, not tests/tier1.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "@/components/ui/Menu";
import { computeMenuBounds, type BoundsInput } from "@/components/ui/menu-bounds";

afterEach(() => {
  cleanup();
  // jsdom shares one window between the tests: the visual viewport stub
  // and the viewport size must not leak into the next test.
  delete (window as { visualViewport?: unknown }).visualViewport;
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

const ITEMS = Array.from({ length: 24 }, (_, index) => ({
  label: `Long menu action ${index + 1}`,
}));

type Box = { top: number; bottom: number; left: number; right: number };

/** A rect the test can move afterwards (the trigger scrolls away). */
function stubRect(element: HTMLElement, box: Box | (() => Box)) {
  element.getBoundingClientRect = () => {
    const value = typeof box === "function" ? box() : box;
    return {
      ...value,
      width: value.right - value.left,
      height: value.bottom - value.top,
      x: value.left,
      y: value.top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function setViewport({ width, height }: { width: number; height: number }) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

type VisualViewportStub = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  emit: (type: string) => void;
};

/** jsdom has no visual viewport; the phone keyboard shrinks that one. */
function installVisualViewport(size: { width: number; height: number }) {
  const listeners = new Map<string, Set<() => void>>();
  const stub: VisualViewportStub = {
    width: size.width,
    height: size.height,
    offsetLeft: 0,
    offsetTop: 0,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  Object.defineProperty(window, "visualViewport", {
    value: stub,
    configurable: true,
  });
  return stub;
}

function openMenu(triggerBox: Box | (() => Box)) {
  render(<Menu label="Account" trigger="Account" items={ITEMS} />);
  const trigger = screen.getByRole("button", { name: "Account" });
  stubRect(trigger, triggerBox);
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByRole("menu") };
}

function maxHeightOf(menu: HTMLElement) {
  return Number.parseInt(menu.style.maxHeight, 10);
}

function maxWidthOf(menu: HTMLElement) {
  return Number.parseInt(menu.style.maxWidth, 10);
}

describe("Menu bounds while it is open", () => {
  it("re-measures the open menu when the window is resized", () => {
    setViewport({ width: 1280, height: 900 });
    const { menu } = openMenu({ top: 100, bottom: 144, left: 0, right: 44 });
    const before = maxHeightOf(menu);
    expect(before).toBeGreaterThan(0);

    setViewport({ width: 1280, height: 300 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const after = maxHeightOf(screen.getByRole("menu"));
    expect(after).not.toBe(before);
    expect(after).toBeLessThanOrEqual(300 - 144);
  });

  it("re-measures when the visual viewport shrinks (the phone keyboard)", () => {
    setViewport({ width: 390, height: 844 });
    const visual = installVisualViewport({ width: 390, height: 844 });
    const { menu } = openMenu({ top: 100, bottom: 144, left: 8, right: 52 });
    const before = maxHeightOf(menu);
    expect(before).toBeGreaterThan(0);

    visual.height = 260;
    act(() => {
      visual.emit("resize");
    });

    const after = maxHeightOf(screen.getByRole("menu"));
    expect(after).toBeLessThanOrEqual(260 - 144);
    expect(after).toBeLessThan(before);
  });

  it("never forces the menu taller than the room it actually has", () => {
    // A 120px tall viewport with the trigger in the middle leaves 32px
    // below and 36px above. A floor of 80px would push the menu off the
    // screen.
    setViewport({ width: 390, height: 120 });
    const { menu } = openMenu({ top: 40, bottom: 84, left: 8, right: 52 });

    const height = maxHeightOf(menu);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThanOrEqual(36);
  });

  it("closes when the trigger scrolls out of the viewport", () => {
    setViewport({ width: 1280, height: 600 });
    let box: Box = { top: 100, bottom: 144, left: 0, right: 44 };
    const { menu } = openMenu(() => box);
    expect(menu).toBeTruthy();

    box = { top: -300, bottom: -256, left: 0, right: 44 };
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the menu inside a narrow viewport", () => {
    setViewport({ width: 180, height: 600 });
    const { menu } = openMenu({ top: 10, bottom: 54, left: 0, right: 44 });

    const width = maxWidthOf(menu);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(180);
    expect(Number.parseInt(menu.style.minWidth, 10)).toBeLessThanOrEqual(width);
  });

  it("nudges the menu back inside when the trigger leaves no room beside it", () => {
    // 180px wide, the trigger 20px from the left: a 172px menu beside
    // it would run 12px off the screen and give the page a horizontal
    // scrollbar. The menu has to move, not overflow.
    setViewport({ width: 180, height: 600 });
    const { menu } = openMenu({ top: 10, bottom: 54, left: 20, right: 64 });

    const width = Number.parseInt(menu.style.minWidth, 10);
    const marginLeft = Number.parseInt(menu.style.marginLeft || "0", 10);
    const marginRight = Number.parseInt(menu.style.marginRight || "0", 10);
    const isStart = menu.className.includes("left-0");
    const left = isStart ? 20 + marginLeft : 64 - width - marginRight;
    const right = isStart ? left + width : 64 - marginRight;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(180);
  });

  it("keeps the menu inside the nearest clipping ancestor", () => {
    setViewport({ width: 1280, height: 900 });
    render(
      <div data-testid="clip" style={{ overflow: "auto" }}>
        <Menu label="Account" trigger="Account" items={ITEMS} />
      </div>,
    );
    const clip = screen.getByTestId("clip");
    stubRect(clip, { top: 60, left: 0, right: 400, bottom: 260 });
    const trigger = screen.getByRole("button", { name: "Account" });
    stubRect(trigger, { top: 100, bottom: 144, left: 8, right: 52 });
    fireEvent.click(trigger);

    const height = maxHeightOf(screen.getByRole("menu"));
    expect(height).toBeGreaterThan(0);
    // The clipping box ends at 260: the room below the trigger is 112.
    expect(height).toBeLessThanOrEqual(260 - 144);
  });

  it("re-measures when the clipping ancestor scrolls", () => {
    setViewport({ width: 1280, height: 900 });
    render(
      <div data-testid="clip" style={{ overflow: "auto" }}>
        <Menu label="Account" trigger="Account" items={ITEMS} />
      </div>,
    );
    const clip = screen.getByTestId("clip");
    stubRect(clip, { top: 60, left: 0, right: 400, bottom: 260 });
    let box: Box = { top: 100, bottom: 144, left: 8, right: 52 };
    const trigger = screen.getByRole("button", { name: "Account" });
    stubRect(trigger, () => box);
    fireEvent.click(trigger);
    const before = maxHeightOf(screen.getByRole("menu"));

    // The column scrolls: the trigger moves up inside the clipping box.
    box = { top: 70, bottom: 114, left: 8, right: 52 };
    act(() => {
      clip.dispatchEvent(new Event("scroll"));
    });

    const after = maxHeightOf(screen.getByRole("menu"));
    expect(after).not.toBe(before);
  });
});

describe("Menu listener hygiene", () => {
  it("removes its viewport and scroll listeners when the menu closes", () => {
    setViewport({ width: 1280, height: 900 });
    const visual = installVisualViewport({ width: 1280, height: 900 });
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeVisual = vi.spyOn(visual, "removeEventListener");

    const { trigger } = openMenu({ top: 100, bottom: 144, left: 0, right: 44 });
    fireEvent.click(trigger);
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    const removed = removeWindow.mock.calls.map(([type]) => type);
    expect(removed).toContain("resize");
    expect(removed).toContain("scroll");
    expect(removeVisual).toHaveBeenCalled();

    removeWindow.mockRestore();
    removeVisual.mockRestore();
  });
});

// The geometry behind the component: rectangles in, a decision out.
// These cover the corners the browser checks afterwards.
describe("Menu bounds geometry", () => {
  const base: BoundsInput = {
    trigger: { top: 100, bottom: 144, left: 400, right: 444 },
    visible: { top: 0, left: 0, right: 1280, bottom: 900 },
    clip: null,
    align: "end",
  };

  it("takes the room under the trigger and no more", () => {
    const bounds = computeMenuBounds(base);
    expect(bounds.placement).toBe("below");
    // The room is 752px, but a long menu stops growing and scrolls.
    expect(bounds.maxHeight).toBe(320);
    expect(bounds.maxHeight).toBeLessThanOrEqual(900 - 144 - 4);
  });

  it("opens above the trigger when there is no room below it", () => {
    const bounds = computeMenuBounds({
      ...base,
      trigger: { top: 300, bottom: 344, left: 400, right: 444 },
      visible: { top: 0, left: 0, right: 1280, bottom: 400 },
    });
    expect(bounds.placement).toBe("above");
    expect(bounds.maxHeight).toBe(300 - 4);
  });

  it("never claims more room than it has, however little that is", () => {
    // A 120px tall screen with the trigger in the middle: 32px below,
    // 36px above. A floor of 80px would push the menu off the screen.
    const bounds = computeMenuBounds({
      ...base,
      trigger: { top: 40, bottom: 84, left: 400, right: 444 },
      visible: { top: 0, left: 0, right: 1280, bottom: 120 },
    });
    expect(bounds.maxHeight).toBeLessThanOrEqual(36);
    expect(bounds.maxHeight).toBeGreaterThan(0);
  });

  it("keeps the width inside the space the menu may use", () => {
    const bounds = computeMenuBounds({
      ...base,
      visible: { top: 0, left: 0, right: 180, bottom: 600 },
      trigger: { top: 10, bottom: 54, left: 0, right: 44 },
    });
    expect(bounds.maxWidth).toBeLessThanOrEqual(180);
    expect(bounds.align).toBe("start");
  });

  it("lines the menu up with the side the trigger leaves room for", () => {
    const atTheEdge = computeMenuBounds({
      ...base,
      trigger: { top: 100, bottom: 144, left: 0, right: 44 },
    });
    expect(atTheEdge.align).toBe("start");

    const atTheRightEdge = computeMenuBounds({
      ...base,
      trigger: { top: 100, bottom: 144, left: 1236, right: 1280 },
    });
    expect(atTheRightEdge.align).toBe("end");
  });

  it("uses the clipping ancestor's box, not only the screen", () => {
    const bounds = computeMenuBounds({
      ...base,
      clip: { top: 60, left: 0, right: 400, bottom: 260 },
    });
    expect(bounds.maxHeight).toBeLessThanOrEqual(260 - 144);
    expect(bounds.maxWidth).toBeLessThanOrEqual(400);
  });
});
