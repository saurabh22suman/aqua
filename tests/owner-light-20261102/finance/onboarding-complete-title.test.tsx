// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the onboarding page still
// says "Set up your first register" even when every real check is complete.
//
// The completion state is already computed from the REAL items
// (`nextIncomplete === undefined`), so this is a presentation fix only: no
// item, no progress figure and no stored state is mutated, faked or
// re-computed.
//
// Controls that must stay meaningful:
//   * with work still to do, the page keeps its "set up" title and says
//     how many checks are left;
//   * the per-item state, the primary action on the next incomplete step
//     and the completed count are untouched.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import type { OnboardingChecklist } from "@/lib/services/onboarding-checklist";

afterEach(cleanup);

const ITEMS: OnboardingChecklist["items"] = [
  {
    key: "add_members",
    title: "Add your first member",
    detail: "The register and history both start with members.",
    cta: { label: "Add a member", href: "/owner/members/new" },
    complete: true,
  },
  {
    key: "create_batch",
    title: "Create your first batch",
    detail: "A batch is the group a coach runs.",
    cta: { label: "Create a batch", href: "/owner/programs" },
    complete: false,
  },
  {
    key: "assign_coach",
    title: "Assign a coach",
    detail: "A batch needs a coach.",
    cta: { label: "Assign a coach", href: "/owner/staff" },
    complete: false,
  },
];

function checklist(complete: boolean[]): OnboardingChecklist {
  const items = ITEMS.map((item, index) => ({
    ...item,
    complete: complete[index] ?? false,
  }));
  return {
    items,
    completedCount: items.filter((item) => item.complete).length,
    totalCount: items.length,
  };
}

describe("Owner onboarding — the title follows the real checks", () => {
  it("says the register is set up when every check is complete", () => {
    render(
      <OnboardingChecklistView data={checklist([true, true, true])} />,
    );

    // INTENDED RED today: the title still says "Set up your first
    // register" even though nothing is left.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).not.toBe("Set up your first register");
    expect(heading.textContent).toMatch(/complete|ready|set up/i);
  });

  it("keeps the setup title while a check is still open", () => {
    render(<OnboardingChecklistView data={checklist([true, false, false])} />);

    // CONTROL (green today).
    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toBe("Set up your first register");
  });

  it("keeps the real counts and the next open step", () => {
    render(<OnboardingChecklistView data={checklist([true, false, false])} />);

    // CONTROL (green today): the count is the real one and only the next
    // incomplete step carries the primary action.
    expect(screen.getByText("1 of 3 checks complete")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Create a batch/i }).getAttribute("href"),
    ).toBe("/owner/programs");
    expect(screen.queryByRole("link", { name: /Assign a coach/i })).toBeNull();
  });

  it("drops the generic purpose line and the redundant completion overline", () => {
    render(<OnboardingChecklistView data={checklist([true, true, true])} />);
    const text = document.body.textContent ?? "";

    // INTENDED RED today: the page title already says the register is
    // set up and the real count says "3 of 3 checks complete", so a third
    // statement of the same fact — plus a generic purpose line — is noise.
    expect(text).not.toContain("Every check passed.");
    expect(text).not.toContain("Completed");

    // The real count and the per-step results stay.
    expect(text).toContain("3 of 3 checks complete");
    expect(screen.getAllByText("Done")).toHaveLength(3);
  });

  it("drops the generic purpose while work is pending and keeps the next step", () => {
    render(<OnboardingChecklistView data={checklist([true, false, false])} />);
    const text = document.body.textContent ?? "";

    // INTENDED RED today.
    expect(text).not.toContain("Three existing checks; one clear next task.");

    // The pending overline and the next permitted action stay — nothing
    // disappears and no progress is faked.
    expect(text).toContain("What's left");
    expect(screen.getByRole("link", { name: /Create a batch/i })).toBeTruthy();
    expect(screen.getByText("1 of 3 checks complete")).toBeTruthy();
  });
});
