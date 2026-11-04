// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the vocabulary editor's
// preview footer states internal architecture and repeats a fact the page
// already owns.
//
// Today the footer says:
//
//   "Database columns stay member_code, never renamed."
//   "Active locale: en"
//
// `member_code` is a database column name and "tenant isolation"-style
// architecture talk is not what the owner needs from a vocabulary editor.
// The locale is already chosen by the page's locale picker and explained
// by the page's own language-scope note, so the raw "Active locale: en"
// line says it a third time.
//
// What must survive: the meaningful resolved-term preview, the controlled
// vocabulary, the locale choices, the edit/save behaviour and the
// language-scope clarification (which lives on the page and is asserted
// in `settings-purpose-copy.test.tsx`).
//
// This renders the REAL terminology form — the surface the owner actually
// edits — so the failure is the visible copy itself, not a missing module.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/terminology", () => ({
  updateTermOverrideAction: vi.fn(),
  clearTermOverrideAction: vi.fn(),
}));

import { TerminologyForm } from "@/components/terminology/terminology-form";
import type { TerminologyState } from "@/lib/terminology/keys";

const STATE: TerminologyState = { overrides: {}, locale: "en" };

afterEach(cleanup);

describe("Owner vocabulary editor — the preview footer", () => {
  it("keeps the resolved term preview and drops the database jargon", () => {
    render(<TerminologyForm initial={STATE} locale="en" editable />);
    const text = document.body.textContent ?? "";

    // The meaningful preview stays: what today's screens will call the
    // owner, the batch and the session.
    expect(text).toContain("Today's view uses");
    expect(text).toContain("Member");
    expect(text).toContain("Batch");
    expect(text).toContain("Session");

    // INTENDED RED today.
    expect(text).not.toContain("Database columns");
    expect(text).not.toContain("member_code");
    expect(text).not.toContain("never renamed");
  });

  it("does not repeat the raw locale under the preview", () => {
    render(<TerminologyForm initial={STATE} locale="en" editable />);
    const text = document.body.textContent ?? "";

    // INTENDED RED today: the page's locale picker and its language-scope
    // note already say which locale is being edited.
    expect(text).not.toMatch(/Active locale:/);
  });

  it("keeps the vocabulary rows, the locale behaviour and the save control", () => {
    // CONTROL (green today): English is editable.
    render(<TerminologyForm initial={STATE} locale="en" editable />);
    expect(screen.getByTestId("term-member-one")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /save/i }).length).toBeGreaterThan(
      0,
    );

    // CONTROL (green today): a read-only locale stays read-only, and the
    // preview still renders for it.
    cleanup();
    render(<TerminologyForm initial={STATE} locale="hi" editable={false} />);
    expect(document.body.textContent).toMatch(
      /Hindi vocabulary is shown read-only/i,
    );
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(document.body.textContent).toContain("Today's view uses");
  });
});
