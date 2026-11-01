// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

// Owner redesign · System lane — the shared control contract.
//
// The human approved one control system for both presets on 27 October
// 2026 (docs/design/owner-redesign-20261027/contract.md):
//
//   "Standard action buttons, text fields, selects, date and time pickers
//    share a 48px height, 10px radius, 16px control text and consistent
//    horizontal padding. Long actions may wrap and grow; do not clip them
//    to meet a numeric height. Compact table/tertiary controls retain at
//    least 44px effective targets."
//
// This file pins that contract at the primitive level (jsdom cannot lay
// out, so the class contract is what a component test can observe; the
// RENDERED geometry is proved in the browser evidence,
// e2e/owner-redesign-c1-controls.ts).
//
// RED status at the time of writing: the primitives carried the
// pre-redesign metrics — a 44px floor on the standard control
// (`min-h-11`), a 14px radius (`rounded-ctl`), 13–15px control text and a
// flat white secondary button — and app/globals.css declared no control
// token layer at all.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

afterEach(cleanup);

describe("the shared control token layer", () => {
  it("declares one 48px standard control height, a 10px control radius and 16px control text", () => {
    expect(GLOBALS).toMatch(/--radius-ctl:\s*10px/);
    expect(GLOBALS).toMatch(/--control-height-md:\s*48px/);
    expect(GLOBALS).toMatch(/--control-text:\s*16px/);
  });

  it("declares the neutral entry border and the two theme tints the contract asks for", () => {
    // A neutral entry/search field, a very lightly tinted picker and a
    // slightly stronger theme tint for the secondary action button.
    expect(GLOBALS).toContain("--control-border");
    expect(GLOBALS).toContain("--control-surface-picker");
    expect(GLOBALS).toContain("--control-surface-action");
  });

  it("keeps the 44px compact floor beside the 48px standard height", () => {
    expect(GLOBALS).toMatch(/--control-height-sm:\s*44px/);
  });
});

describe("the action button", () => {
  it("uses the 48px standard height, the 10px radius and 16px control text", () => {
    render(<Button size="md">Record payment</Button>);
    const button = screen.getByRole("button", { name: "Record payment" });
    expect(button.className).toContain("min-h-12");
    expect(button.className).toContain("rounded-ctl");
    expect(button.className).toContain("text-[16px]");
  });

  it("keeps the 44px effective target for a compact table/tertiary control", () => {
    render(<Button size="sm">Edit</Button>);
    const button = screen.getByRole("button", { name: "Edit" });
    expect(button.className).toContain("min-h-11");
  });

  it("paints the primary action in the solid theme colour and the secondary in the theme tint", () => {
    render(
      <>
        <Button variant="primary">Collect payment</Button>
        <Button variant="secondary">Add swimmer</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "Collect payment" });
    const secondary = screen.getByRole("button", { name: "Add swimmer" });
    expect(primary.className).toContain("bg-[var(--accent-strong)]");
    expect(secondary.className).toContain("bg-[var(--control-surface-action)]");
  });

  it("lets a long action wrap and grow instead of clipping it to a numeric height", () => {
    render(
      <Button size="md">
        Send attendance reminders to every guardian with an unpaid invoice
      </Button>,
    );
    const button = screen.getByRole("button", {
      name: "Send attendance reminders to every guardian with an unpaid invoice",
    });
    expect(button.className).not.toContain("whitespace-nowrap");
    expect(button.className).not.toContain("truncate");
    expect(button.className).not.toContain("overflow-hidden");
    // The label is never hidden from assistive technology either.
    expect(button.textContent).toContain("unpaid invoice");
  });

  it("keeps the destructive variant on the reserved late token", () => {
    render(<Button variant="destructive">Mark churned</Button>);
    const button = screen.getByRole("button", { name: "Mark churned" });
    expect(button.className).toContain("bg-late");
  });
});

describe("the text, select and date controls", () => {
  it("gives the text field the standard height, radius, padding and text size", () => {
    render(<Input aria-label="Phone" />);
    const input = screen.getByLabelText("Phone");
    expect(input.className).toContain("min-h-12");
    expect(input.className).toContain("rounded-ctl");
    expect(input.className).toContain("text-[16px]");
    expect(input.className).toContain("px-4");
  });

  it("gives the select the same standard metrics", () => {
    render(
      <Select aria-label="Facility">
        <option value="all">All facilities</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    expect(select.className).toContain("min-h-12");
    expect(select.className).toContain("rounded-ctl");
    expect(select.className).toContain("text-[16px]");
  });

  it("gives the date field the same standard metrics", () => {
    render(
      <DateField value="" onChange={() => {}} aria-label="Date of birth" />,
    );
    const input = screen.getByLabelText("Date of birth");
    expect(input.className).toContain("min-h-12");
    expect(input.className).toContain("rounded-ctl");
    expect(input.className).toContain("text-[16px]");
  });

  it("keeps the textarea on the shared radius and control text size", () => {
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByLabelText("Notes");
    expect(textarea.className).toContain("rounded-ctl");
    expect(textarea.className).toContain("text-[16px]");
  });

  it("marks an invalid control for assistive technology instead of only colouring it", () => {
    render(<Input aria-label="Phone" invalid />);
    expect(screen.getByLabelText("Phone").getAttribute("aria-invalid")).toBe("true");
  });
});
