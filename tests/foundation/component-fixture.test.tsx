// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// UI foundation — the component fixture.
//
// The fixture is the review surface for the foundation: one place that
// shows every primitive with synthetic data, so a change to a
// primitive can be reviewed in one glance instead of hunting for the
// page that happens to use it.
//
// It is deliberately a TEST fixture (docs/design-system/visual-contract.md:
// "Build a local component fixture route or test fixture with synthetic
// data; do not expose a debug gallery publicly"). No route mounts it.

import { ComponentFixture } from "@/components/ui/fixture/component-fixture";

afterEach(cleanup);

describe("component fixture", () => {
  it("renders every foundation primitive section", () => {
    render(<ComponentFixture />);
    const fixture = screen.getByTestId("component-fixture");

    for (const heading of [
      "Actions",
      "Fields",
      "Status and feedback",
      "Navigation and overlays",
      "Empty state",
    ]) {
      expect(within(fixture).getByText(heading)).toBeTruthy();
    }
  });

  it("shows the field states a reviewer has to see", () => {
    render(<ComponentFixture />);
    expect(screen.getByLabelText(/Phone/)).toBeTruthy();
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("valid email"))).toBe(true);
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Page 2 of 7")).toBeTruthy();
  });

  it("carries no real data — every value is synthetic", () => {
    const { container } = render(<ComponentFixture />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/₹/);
    expect(text).not.toMatch(/\d{4,}/);
  });
});
