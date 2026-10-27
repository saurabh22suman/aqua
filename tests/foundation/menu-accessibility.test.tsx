// @vitest-environment jsdom
//
// Menu accessibility — the shared dropdown primitive.
//
// Covers the interaction contract a menu button owes its user:
// the keyboard opens it (Enter / Space / ArrowDown / ArrowUp), the
// first *available* action takes focus, unavailable actions are
// skipped without trapping the arrow keys, Escape gives the focus
// back, Tab leaves the menu the way the browser wants (no trap) and
// closes it, a pointer outside dismisses it, an icon-only trigger
// still has an accessible name and a long menu stays inside the
// viewport and scrolls.
//
// These are agent-owned tests (tests/foundation), not the protected
// tests/tier1 suite.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Menu } from "@/components/ui/Menu";

afterEach(cleanup);

/** Let a macrotask (the deferred close after Tab) run inside act(). */
async function flushTasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stubViewport({ height, triggerTop }: { height: number; triggerTop: number }) {
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
    writable: true,
  });
  return (element: HTMLElement) => {
    element.getBoundingClientRect = () =>
      ({
        top: triggerTop,
        bottom: triggerTop + 44,
        left: 0,
        right: 44,
        width: 44,
        height: 44,
        x: 0,
        y: triggerTop,
        toJSON: () => ({}),
      }) as DOMRect;
  };
}

describe("Menu keyboard opening", () => {
  it("opens with ArrowDown and focuses the first available action", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[
          { label: "Unavailable", disabled: true },
          { label: "Profile" },
          { label: "Sign out" },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));
  });

  it("opens with ArrowUp and focuses the last available action", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[
          { label: "Profile" },
          { label: "Sign out" },
          { label: "Unavailable", disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
  });

  it("opens with Enter and focuses the first available action", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[{ label: "Unavailable", disabled: true }, { label: "Profile" }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));
  });

  it("opens with Space and focuses the first available action", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[{ label: "Unavailable", disabled: true }, { label: "Profile" }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: " " });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));
  });

  it("does not open when the trigger is not the one being used", () => {
    render(<Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    fireEvent.keyDown(outside, { key: "ArrowDown" });

    expect(screen.queryByRole("menu")).toBeNull();
    outside.remove();
  });
});

describe("Menu arrow navigation", () => {
  it("skips unavailable actions and wraps in both directions", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[
          { label: "Unavailable first", disabled: true },
          { label: "Profile" },
          { label: "Sign out" },
          { label: "Unavailable last", disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
  });

  it("keeps the focus on the trigger when every action is unavailable", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[{ label: "Unavailable", disabled: true }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    expect(document.activeElement).toBe(trigger);
  });
});

describe("Menu dismissal", () => {
  it("closes on Escape and gives the focus back to the trigger", () => {
    render(<Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />);
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a pointer press outside the menu", () => {
    render(
      <div>
        <Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when the trigger is pressed again", () => {
    render(<Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />);
    const trigger = screen.getByRole("button", { name: "Account" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Menu tab exit", () => {
  it("lets Tab keep the browser's own order (no focus trap) and closes the menu", async () => {
    render(
      <div>
        <Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />
        <button type="button">After the menu</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const item = screen.getByRole("menuitem", { name: "Profile" });
    expect(document.activeElement).toBe(item);

    const notPrevented = fireEvent.keyDown(item, { key: "Tab" });

    // The default was not prevented: the browser keeps its own tab
    // order and the menu does not become a focus trap.
    expect(notPrevented).toBe(true);
    await flushTasks();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps only one action in the tab order while the menu is open", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[{ label: "Profile" }, { label: "Sign out" }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    fireEvent.click(trigger);

    const items = screen.getAllByRole("menuitem");
    expect(items.filter((item) => item.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(items.filter((item) => item.getAttribute("tabindex") === "-1")).toHaveLength(1);
  });
});

describe("Menu trigger name", () => {
  it("names an icon-only trigger", () => {
    render(
      <Menu
        label="Account"
        trigger={<svg aria-hidden="true" focusable="false" />}
        items={[{ label: "Profile" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  });

  it("keeps the visible trigger text as the accessible name", () => {
    render(<Menu label="Account menu" trigger="Profile" items={[{ label: "Profile" }]} />);

    const trigger = screen.getByRole("button", { name: "Profile" });
    expect(trigger.getAttribute("aria-label")).toBeNull();
  });

  it("uses an explicit trigger name when the caller gives one", () => {
    render(
      <Menu
        label="Account"
        triggerLabel="Account options"
        trigger={<svg aria-hidden="true" focusable="false" />}
        items={[{ label: "Profile" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Account options" })).toBeTruthy();
  });
});

describe("Menu bounded layout", () => {
  it("keeps a long menu inside the viewport and makes it scrollable", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={Array.from({ length: 24 }, (_, index) => ({
          label: `Action ${index + 1}`,
        }))}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    stubViewport({ height: 600, triggerTop: 100 })(trigger);

    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    const maxHeight = Number.parseInt(menu.style.maxHeight, 10);
    // The menu may not be taller than the room left under the trigger.
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(600 - 144);
    expect(menu.style.overflowY).toBe("auto");
  });

  it("does not open a menu that has no actions", () => {
    render(<Menu label="Account" trigger="Account" items={[]} />);
    const trigger = screen.getByRole("button", { name: "Account" });

    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a right-aligned menu on the screen when the trigger sits at the edge", () => {
    render(<Menu label="Account" trigger="Account" items={[{ label: "Profile" }]} />);
    const trigger = screen.getByRole("button", { name: "Account" });
    // The trigger's right edge is 44px from the left of the viewport: a
    // right-aligned menu (200px wide) would hang off the left edge.
    // The class list is the cheap guard here; the browser evidence
    // (docs/handoffs/evidence/menu-accessibility) carries the geometry.
    trigger.getBoundingClientRect = () =>
      ({
        top: 40,
        bottom: 84,
        left: 0,
        right: 44,
        width: 44,
        height: 44,
        x: 0,
        y: 40,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      configurable: true,
      writable: true,
    });

    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("left-0");
    expect(menu.className).not.toContain("right-0");
  });
});
