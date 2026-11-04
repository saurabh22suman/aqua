// @vitest-environment jsdom
//
// PROVENANCE (foundation lane, 2 November 2026): this file is the
// INHERITED test of the reviewed transient-disclosure patch
// (outputs/owner-menu-dismissal-20261102/LOCAL-MENU-FIX.patch, originally
// tests/owner-menu-dismissal-20261102/transient-disclosure.test.tsx).
// Its intended RED was observed BEFORE that implementation — the
// evidence is outputs/owner-menu-dismissal-20261102/red-run.log, and it
// belongs to that run; it is NOT re-created or claimed here. The file
// is carried into the lane's own test folder unchanged apart from this
// provenance note.
//
// The shared transient disclosure, on its own.
//
// The three owner surfaces are covered where they live (see
// owner-transient-surfaces.test.tsx). This file covers the SHARED
// primitive itself, so the next caller of it gets the same contract:
// the native disclosure still opens and closes the surface, and the
// dismissal rules (outside press, focus leaving, Escape, the route
// changing, a navigation action, one surface at a time) hold for any
// caller — not only for the three owner surfaces.
//
// Supplementary coverage for the shared primitive, written after the
// implementation; the intended RED is in owner-transient-surfaces.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/owner" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { TransientDisclosure } from "@/components/ui/TransientDisclosure";

afterEach(() => {
  cleanup();
  navigation.pathname = "/owner";
});

function surface(label: string) {
  const trigger = screen.getByText(label).closest("summary") as HTMLElement;
  return { trigger, details: trigger.closest("details") as HTMLDetailsElement };
}

describe("TransientDisclosure", () => {
  it("opens and closes with the native disclosure", () => {
    render(
      <TransientDisclosure trigger="One">
        <button type="button">Inside</button>
      </TransientDisclosure>,
    );
    const { trigger, details } = surface("One");

    fireEvent.click(trigger);
    expect(details.open).toBe(true);

    fireEvent.click(trigger);
    expect(details.open).toBe(false);
  });

  it("closes on an outside press without taking the focus", () => {
    render(
      <div>
        <TransientDisclosure trigger="One">
          <button type="button">Inside</button>
        </TransientDisclosure>
        <button type="button">Outside</button>
      </div>,
    );
    const { trigger, details } = surface("One");
    fireEvent.click(trigger);
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(details.open).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("closes when the focus leaves it", () => {
    render(
      <div>
        <TransientDisclosure trigger="One">
          <button type="button">Inside</button>
        </TransientDisclosure>
        <button type="button">Outside</button>
      </div>,
    );
    const { details } = surface("One");
    fireEvent.click(screen.getByText("One").closest("summary") as HTMLElement);
    screen.getByRole("button", { name: "Inside" }).focus();

    screen.getByRole("button", { name: "Outside" }).focus();

    expect(details.open).toBe(false);
  });

  it("closes on Escape and gives the focus back to its own trigger", () => {
    render(
      <TransientDisclosure trigger="One">
        <button type="button">Inside</button>
      </TransientDisclosure>,
    );
    const { trigger, details } = surface("One");
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Inside" }).focus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the route changes", () => {
    const { rerender } = render(
      <TransientDisclosure trigger="One">
        <button type="button">Inside</button>
      </TransientDisclosure>,
    );
    const { details } = surface("One");
    fireEvent.click(screen.getByText("One").closest("summary") as HTMLElement);
    expect(details.open).toBe(true);

    navigation.pathname = "/owner/reports";
    rerender(
      <TransientDisclosure trigger="One">
        <button type="button">Inside</button>
      </TransientDisclosure>,
    );

    expect(details.open).toBe(false);
  });

  it("closes when a navigation action inside it is chosen", () => {
    render(
      <TransientDisclosure trigger="One">
        <a href="/owner/reports">Reports</a>
      </TransientDisclosure>,
    );
    const { trigger, details } = surface("One");
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("link", { name: "Reports" }));

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps only one surface open at a time", () => {
    render(
      <div>
        <TransientDisclosure trigger="One">
          <button type="button">Inside one</button>
        </TransientDisclosure>
        <TransientDisclosure trigger="Two">
          <button type="button">Inside two</button>
        </TransientDisclosure>
      </div>,
    );
    const first = surface("One");
    const second = surface("Two");

    fireEvent.click(first.trigger);
    expect(first.details.open).toBe(true);

    fireEvent.click(second.trigger);

    expect(first.details.open).toBe(false);
    expect(second.details.open).toBe(true);
  });

  it("gives Escape back to the trigger of the surface that was open", () => {
    render(
      <div>
        <TransientDisclosure trigger="One">
          <button type="button">Inside one</button>
        </TransientDisclosure>
        <TransientDisclosure trigger="Two">
          <button type="button">Inside two</button>
        </TransientDisclosure>
      </div>,
    );
    const first = surface("One");
    const second = surface("Two");
    fireEvent.click(first.trigger);
    fireEvent.click(second.trigger);
    expect(first.details.open).toBe(false);

    fireEvent.keyDown(screen.getByRole("button", { name: "Inside two" }), { key: "Escape" });

    expect(second.details.open).toBe(false);
    expect(document.activeElement).toBe(second.trigger);
    expect(document.activeElement).not.toBe(first.trigger);
  });
});
