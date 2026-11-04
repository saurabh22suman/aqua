// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the existing "Add plan"
// disclosure is a create affordance, but its summary only carries a
// down-chevron, so nothing in the COLLAPSED state says "this creates a plan".
//
// The approved remedy is the shared Owner outline `plus` (Foundation-owned,
// read-only `components/owner-ui/owner-icon.tsx`: 24x24 viewBox, fill=none,
// stroke=currentColor, stroke-width 1.8, round caps/joins, decorative), shown
// only while the disclosure is collapsed and replaced by a meaningful
// open-state treatment (the chevron turns up, the plus is gone).
//
// Scope kept deliberately narrow: one existing <details>/<summary>. The plan
// create/edit form, its validation, permissions and the single inline form are
// unchanged — no FAB, no second Save-plus and no new flow. Native
// details/summary keyboard behaviour is preserved because this stays a native
// disclosure; the collapsed/open rule is declared with Tailwind's `group-open`
// variant (jsdom does not compute stylesheets, so the actual open-state paint
// is Root's browser check, not this test's claim).

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createPlanAction = vi.hoisted(() => vi.fn());
const updatePlanAction = vi.hoisted(() => vi.fn());
const archivePlanAction = vi.hoisted(() => vi.fn());
const activatePlanFromShapeAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/membership-plans", () => ({
  createPlanAction,
  updatePlanAction,
  archivePlanAction,
  activatePlanFromShapeAction,
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { PlanManager } from "@/components/plan-manager";

const LOC = { id: "11111111-1111-4111-8111-111111111111", name: "Worli" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderManager() {
  return render(
    <PlanManager templates={[]} plans={[]} locations={[LOC]} activities={[]} />,
  );
}

/** The disclosure whose summary starts with the given label. */
function disclosure(container: HTMLElement, label: string): HTMLDetailsElement {
  const summary = Array.from(container.querySelectorAll("summary")).find(
    (candidate) => candidate.textContent?.trim().startsWith(label),
  );
  expect(summary, `the "${label}" disclosure exists`).toBeTruthy();
  return summary!.closest("details") as HTMLDetailsElement;
}

describe("Add plan disclosure affordance", () => {
  it("shows the approved outline plus on the collapsed create disclosure", () => {
    const { container } = renderManager();
    const add = disclosure(container, "Add plan");
    const summary = add.querySelector("summary")!;

    // The plus lives in the summary itself — the collapsed row is the cue.
    // Find it by its own approved geometry so the chevron can never stand in
    // for it.
    const plus = Array.from(summary.querySelectorAll("svg")).find((svg) =>
      Array.from(svg.querySelectorAll("path")).some(
        (path) => path.getAttribute("d") === "M12 5v14M5 12h14",
      ),
    );
    expect(
      plus,
      "the collapsed create affordance carries the approved outline plus",
    ).toBeTruthy();

    // The approved shared outline contract.
    expect(plus!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(plus!.getAttribute("fill")).toBe("none");
    expect(plus!.getAttribute("stroke")).toBe("currentColor");
    expect(plus!.getAttribute("stroke-width")).toBe("1.8");
    expect(plus!.getAttribute("stroke-linecap")).toBe("round");
    expect(plus!.getAttribute("stroke-linejoin")).toBe("round");
    // Decorative: the row's own words ("Add plan") carry the meaning.
    expect(plus!.getAttribute("aria-hidden")).toBe("true");

    // The approved mock's own plus geometry — not "some outline icon".
    const paths = Array.from(plus!.querySelectorAll("path")).map((path) =>
      path.getAttribute("d"),
    );
    expect(paths).toEqual(["M12 5v14M5 12h14"]);

    // Meaningful open-state treatment, declared: the plus is creation-only
    // while collapsed, and the disclosure's own chevron turns up when open.
    expect(plus!.getAttribute("class") ?? "").toContain("group-open:hidden");
    expect(add.getAttribute("class") ?? "").toContain("group");
    const chevron = Array.from(summary.querySelectorAll("svg")).find(
      (svg) => svg !== plus,
    );
    expect(chevron, "the disclosure keeps its chevron").toBeTruthy();
    expect(chevron!.getAttribute("class") ?? "").toContain(
      "group-open:rotate-180",
    );
  });

  it("does not add a second create affordance to the preset disclosure", () => {
    const { container } = renderManager();
    const preset = disclosure(container, "Use a preset template");
    const presetSummary = preset.querySelector("summary")!;

    const plusLike = Array.from(presetSummary.querySelectorAll("path")).some(
      (path) => path.getAttribute("d") === "M12 5v14M5 12h14",
    );
    expect(plusLike, "no duplicate plus on the preset template row").toBe(false);
  });

  it("keeps the single inline create form and the existing plan flow", () => {
    const { container } = renderManager();
    const add = disclosure(container, "Add plan");

    // Still one inline form inside the disclosure, with its own submit.
    expect(
      within(add).getByRole("button", { name: "Add plan" }),
    ).toBeTruthy();
    // The preset flow is still offered; nothing was replaced or duplicated.
    expect(disclosure(container, "Use a preset template")).toBeTruthy();
    // No floating action button or extra create trigger was introduced.
    expect(
      container.querySelectorAll('button[aria-label*="plan" i]').length,
    ).toBe(0);
  });
});
