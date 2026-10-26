// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Menu } from "@/components/ui/Menu";

afterEach(cleanup);

describe("menu keyboard access with unavailable actions", () => {
  it("moves past a disabled action instead of trapping the keyboard", () => {
    render(<Menu label="Account" trigger="Account" items={[
      { label: "Profile" }, { label: "Unavailable", disabled: true }, { label: "Sign out" },
    ]} />);
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Profile" }));
  });

  it("wraps over disabled boundary actions in both directions", () => {
    render(<Menu label="Actions" trigger="Actions" items={[
      { label: "Unavailable first", disabled: true }, { label: "Available" },
      { label: "Unavailable last", disabled: true },
    ]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const available = screen.getByRole("menuitem", { name: "Available" });
    expect(document.activeElement).toBe(available);
    fireEvent.keyDown(available, { key: "ArrowUp" });
    expect(document.activeElement).toBe(available);
    fireEvent.keyDown(available, { key: "ArrowDown" });
    expect(document.activeElement).toBe(available);
  });

  it("keeps focus on the trigger when every action is disabled", () => {
    render(<Menu label="Actions" trigger="Actions" items={[
      { label: "Unavailable", disabled: true },
    ]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(document.activeElement).toBe(trigger);
  });
});
