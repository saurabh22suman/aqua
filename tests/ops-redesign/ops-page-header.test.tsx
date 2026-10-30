// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the page header's action slot.
//
// The header is a flex row: the heading block on the left, and — when
// there is one — the action/meta slot on the right. The slot was
// rendered even when it was EMPTY, and an empty flex item still
// WRAPS: on the new-tenant page the heading group was wide enough to
// push the empty slot onto a second row, which added a whole row gap
// between the heading and the form.
//
// The root measured it in Chrome: the content block ended at 152.5px,
// the empty slot wrapped to a zero-height row at 168.5px, and the card
// started at 200.5px — a 48px gap where ONE 32px gap belongs.
//
// The slot is now rendered only when it carries something. When it
// does carry something, the wrapper and ALL its content stay exactly
// as they were.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpsPageHeader } from "@/components/ops/ops-primitives";

afterEach(cleanup);

describe("OpsPageHeader — the action slot", () => {
  it("renders ONE content block when there is neither an action nor a meta note", () => {
    const { container } = render(
      <OpsPageHeader
        eyebrow="Tenants"
        title="New tenant"
        lede="Creates the tenant record, its first location, and an audit trail."
      />,
    );

    const header = container.firstElementChild;
    expect(header).not.toBeNull();
    // The heading group, and nothing else: no empty second column to
    // wrap onto its own row.
    expect(header!.children).toHaveLength(1);
    expect(
      header!.querySelectorAll('[data-testid="ops-page-header-actions"]'),
    ).toHaveLength(0);
    // The heading itself is untouched.
    expect(screen.getByRole("heading", { name: "New tenant" })).toBeDefined();
  });

  it("keeps the action slot, and the action itself, when an action is given", () => {
    render(
      <OpsPageHeader
        title="All tenants"
        actions={
          <button type="button">New tenant</button>
        }
      />,
    );

    expect(screen.getByTestId("ops-page-header-actions")).toBeDefined();
    expect(screen.getByRole("button", { name: "New tenant" })).toBeDefined();
  });

  it("keeps the action slot, and the note, when a meta note is given", () => {
    render(
      <OpsPageHeader title="Activity" meta="Last refreshed 28 Oct 2026 IST" />,
    );

    expect(screen.getByTestId("ops-page-header-actions")).toBeDefined();
    expect(screen.getByText("Last refreshed 28 Oct 2026 IST")).toBeDefined();
  });

  it("keeps both the action and the note when both are given", () => {
    render(
      <OpsPageHeader
        title="Activity"
        actions={<button type="button">Refresh</button>}
        meta="Last refreshed 28 Oct 2026 IST"
      />,
    );

    const slot = screen.getByTestId("ops-page-header-actions");
    expect(slot).toBeDefined();
    expect(within(slot).getByRole("button", { name: "Refresh" })).toBeDefined();
    expect(within(slot).getByText("Last refreshed 28 Oct 2026 IST")).toBeDefined();
  });

  it("treats a null meta note as no meta note", () => {
    const { container } = render(
      <OpsPageHeader title="Aqua control plane" meta={null} />,
    );
    const header = container.firstElementChild!;
    expect(header.children).toHaveLength(1);
  });
});
