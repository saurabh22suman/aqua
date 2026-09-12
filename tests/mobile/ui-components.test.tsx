// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Phase 1a (mobile UX plan v2) — the four shared components. The
// audits they compose away (F9/F10/F11/F25 targets, F19/F22/F27 empty
// states, F37 visible labels) were all repeated inline patterns; the
// contract pinned here is deliberately small so call sites can adopt
// them without redesign.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown }) => {
      const { href, children, ...rest } = props as {
        href?: unknown;
        children?: unknown;
        [k: string]: unknown;
      };
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as ReactNode,
      );
    },
  };
});

import { EmptyState } from "@/components/ui/EmptyState";
import { Row } from "@/components/ui/Row";
import { Tap } from "@/components/ui/Tap";
import { FieldError } from "@/components/ui/FieldError";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title, body and an action that is a link when href is given", () => {
    render(
      <EmptyState
        title="No members yet."
        body="Add your first member."
        action={{ label: "Add member", href: "/owner/members/new" }}
      />,
    );

    expect(screen.getByText("No members yet.")).toBeTruthy();
    expect(screen.getByText("Add your first member.")).toBeTruthy();
    const link = screen.getByText("Add member").closest("a");
    expect(link?.getAttribute("href")).toBe("/owner/members/new");
  });

  it("renders a button when the action has onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here." action={{ label: "Retry", onClick }} />);

    const button = screen.getByText("Retry").closest("button");
    expect(button).not.toBeNull();
    button?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders without body or action", () => {
    const { container } = render(<EmptyState title="Empty." />);
    expect(container.textContent).toContain("Empty.");
  });
});

describe("Row", () => {
  it("renders a visible label, the value, and an optional action", () => {
    render(
      <Row
        label="Phone"
        value="+91 98123 40010"
        action={<button aria-label="Edit phone">Edit</button>}
      />,
    );

    expect(screen.getByText("+91 98123 40010")).toBeTruthy();
    expect(screen.getByText("Phone")).toBeTruthy();
    expect(screen.getByLabelText("Edit phone")).toBeTruthy();
  });
});

describe("Tap", () => {
  it("adds a 44px minimum hit area to the wrapped control without dropping its classes", () => {
    render(
      <Tap>
        <button aria-label="Edit" className="rounded-ctl text-ink-3">
          x
        </button>
      </Tap>,
    );

    const button = screen.getByLabelText("Edit");
    expect(button.className).toContain("rounded-ctl");
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
  });

  it("supports the 48px primary-action variant", () => {
    render(
      <Tap min={48}>
        <button aria-label="Delete">x</button>
      </Tap>,
    );

    const button = screen.getByLabelText("Delete");
    expect(button.className).toContain("min-h-12");
    expect(button.className).toContain("min-w-12");
  });
});

describe("FieldError", () => {
  it("renders an alert with the message and an id an input can reference", () => {
    render(<FieldError id="phone-error">Enter a 10-digit number.</FieldError>);

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("id")).toBe("phone-error");
    expect(alert.textContent).toContain("Enter a 10-digit number.");
  });

  it("renders nothing when there is no error", () => {
    const { container } = render(<FieldError>{null}</FieldError>);
    expect(container.textContent).toBe("");
  });
});
