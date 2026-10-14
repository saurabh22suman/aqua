// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — the vocabulary editor only offers
// Save for locales the server accepts (English today), non-writable
// locales render read-only, and the sample sentence fits each term
// rather than calling every term "marked present".

vi.mock("@/lib/actions/terminology", () => ({
  updateTermOverrideAction: vi.fn(),
  clearTermOverrideAction: vi.fn(),
}));

import { TerminologyForm } from "@/components/terminology/terminology-form";
import type { TerminologyState } from "@/lib/terminology/keys";

const STATE: TerminologyState = { overrides: {}, locale: "en" };

afterEach(cleanup);

describe("TerminologyForm locale truthfulness (P1)", () => {
  it("renders Hindi read-only with no Save controls", () => {
    render(<TerminologyForm initial={STATE} locale="hi" editable={false} />);
    expect(document.body.textContent).toMatch(/Hindi vocabulary is shown read-only/i);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByTestId("term-member-one")).toBeNull();
    // Resolved defaults are still visible.
    expect(document.body.textContent).toContain("सदस्य");
  });

  it("keeps English editable", () => {
    render(<TerminologyForm initial={STATE} locale="en" editable />);
    expect(screen.getByTestId("term-member-one")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /save/i }).length).toBeGreaterThan(0);
  });

  it("uses per-term sample wording instead of 'marked present' for every term", () => {
    render(<TerminologyForm initial={STATE} locale="en" editable />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Primary guardian");
    expect(text).toContain("3 enquiries awaiting follow-up");
    expect(text).toContain("12 members");
    expect(text).not.toContain("guardian marked present");
    expect(text).not.toContain("enquiry marked present");
  });
});
