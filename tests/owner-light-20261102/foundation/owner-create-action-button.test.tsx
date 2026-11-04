// @vitest-environment jsdom
import type { FormEvent } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the create action's BUTTON variant.
//
// The Root's whole-owner requirement (3 November 2026): EVERY owner
// create affordance follows the ONE approved pattern — the outlined
// plus, the 56px phone floating action above the navigation, the
// labelled desktop action — including the pages whose create affordance
// is a CLIENT action (Programs and Enquiries open a create panel in the
// browser instead of navigating to a route).
//
// The shared action only knew an href, so those pages fell back to an
// ordinary boxed "Add" button: a different shape, a different
// affordance, and no clearance marker. This file pins the ONE bounded
// extension — a strictly typed, mutually exclusive button variant for
// an existing client parent's onClick callback — and the regressions
// that keep the approved pattern intact:
//
//   - the callback runs EXACTLY ONCE per click,
//   - the control is type="button": it never submits an enclosing form,
//   - it carries ONE accessible name and ONE decorative plus,
//   - it has the SAME geometry and the SAME clearance marker as the
//     link (ONE class map, not two) and NO href at all,
//   - the route link and the native same-page fragment are untouched.
//
// RED PROVENANCE: written BEFORE the source edit. The current
// component only knows an href, so rendering the button variant throws
// (there is no href to read) and the assertions below fail on the
// missing variant; the typed contract fails `pnpm typecheck` too,
// because the props are not a discriminated union yet.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        // The marker tells a ROUTED link from a native anchor: the
        // framework link intercepts the click, so it never performs the
        // browser's own fragment navigation.
        { href: typeof href === "string" ? href : "#", ...rest, "data-routed-link": "true" },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/members",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import {
  OwnerCreateAction,
  type OwnerCreateActionProps,
} from "@/components/owner-ui/owner-create-action";

afterEach(cleanup);

describe("OwnerCreateAction — the button variant", () => {
  it("runs the client parent's callback exactly once per click", () => {
    const onClick = vi.fn();
    render(<OwnerCreateAction kind="button" onClick={onClick} label="Add program" />);

    const button = screen.getByRole("button", { name: "Add program" });
    // Rendering is not activation.
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("is a type=button that never submits an enclosing form", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OwnerCreateAction kind="button" onClick={onClick} label="Add enquiry" />
      </form>,
    );

    const button = screen.getByRole("button", { name: "Add enquiry" });
    expect(button.tagName).toBe("BUTTON");
    // The default type of a button is "submit": a create action inside
    // a form would submit the form it does not belong to.
    expect(button.getAttribute("type")).toBe("button");

    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("carries one accessible name and one decorative plus", () => {
    render(<OwnerCreateAction kind="button" onClick={vi.fn()} label="Add program" />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add program" })).toBe(buttons[0]);

    // ONE plus, and it stays decoration: the label is the accessible name.
    const icons = buttons[0]?.querySelectorAll("svg") ?? [];
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute("aria-hidden")).toBe("true");
    // The label is drawn once.
    expect(screen.getAllByText("Add program")).toHaveLength(1);
  });

  it("has the same geometry and the same clearance marker as the link", () => {
    render(
      <OwnerCreateAction
        kind="button"
        onClick={vi.fn()}
        label="Add program"
        testId="add-program"
      />,
    );
    const button = screen.getByRole("button", { name: "Add program" });

    expect(button.className).toContain("fixed");
    expect(button.className).toContain("h-14");
    expect(button.className).toContain("w-14");
    expect(button.className).toContain("min-h-14");
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("bottom-[var(--owner-fab-bottom");
    expect(button.className).toContain("lg:static");
    expect(button.className).toContain("lg:rounded-ctl");
    // The marker is the hook the owner scope's :has() rule reads, so a
    // page carrying a button action reserves the action's footprint too.
    expect(button.getAttribute("data-owner-create-action")).toBe("");
    expect(button.getAttribute("data-testid")).toBe("add-program");
    // A button is not a link: there is no href to be wrong.
    expect(button.hasAttribute("href")).toBe(false);
  });

  it("draws the button and the link from ONE class map", () => {
    render(<OwnerCreateAction kind="button" onClick={vi.fn()} label="Add program" />);
    const buttonClass = screen.getByRole("button", { name: "Add program" }).className;
    cleanup();

    render(<OwnerCreateAction href="/owner/programs" label="Add program" />);
    const linkClass = screen.getByRole("link", { name: "Add program" }).className;

    // The approved pattern is ONE action: the phone floating action and
    // the desktop labelled action are the same control, so the button
    // variant is the same control too.
    expect(buttonClass).toBe(linkClass);
  });
});

describe("OwnerCreateAction — the link variant is untouched", () => {
  it("keeps the framework link for a real route", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = screen.getByRole("link", { name: "Add member" });

    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/owner/members/new");
    expect(link.getAttribute("data-routed-link")).toBe("true");
    expect(link.getAttribute("data-owner-create-action")).toBe("");
  });

  it("keeps the native anchor for a same-page fragment", () => {
    render(<OwnerCreateAction href="#new-booking" label="New booking" />);
    const link = screen.getByRole("link", { name: "New booking" });

    expect(link.getAttribute("href")).toBe("#new-booking");
    // The browser's OWN fragment navigation scrolls to and focuses the
    // target; the framework link intercepts the click and does not.
    expect(link.hasAttribute("data-routed-link")).toBe(false);
  });
});

describe("OwnerCreateAction — the typed contract", () => {
  it("keeps the link and the button variant mutually exclusive", () => {
    const linkVariant: OwnerCreateActionProps = {
      href: "/owner/members/new",
      label: "Add member",
    };
    const buttonVariant: OwnerCreateActionProps = {
      kind: "button",
      onClick: () => {},
      label: "Add program",
    };

    expect(linkVariant.kind ?? "link").toBe("link");
    expect(buttonVariant.kind).toBe("button");

    // @ts-expect-error a button variant never carries an href
    const buttonWithHref: OwnerCreateActionProps = { kind: "button", href: "/owner/members/new", onClick: () => {}, label: "Add member" };
    // @ts-expect-error a link variant never carries an onClick
    const linkWithOnClick: OwnerCreateActionProps = { href: "/owner/members/new", onClick: () => {}, label: "Add member" };

    expect(buttonWithHref).toBeDefined();
    expect(linkWithOnClick).toBeDefined();
  });
});
