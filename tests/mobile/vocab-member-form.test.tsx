// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 3 (mobile UX plan v2) — F18. The add-member form mixed
// "swimmer" (from resolveTerm in the minor-consent line) with
// hardcoded "member" strings right next to it. This test pins every
// user-visible occurrence to the tenant vocabulary: a swim tenant must
// see "swimmer" everywhere in the form, never "member".

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/people", () => ({
  createMemberAction: vi.fn(),
  searchPersonsAction: vi.fn().mockResolvedValue([]),
}));

import { MemberCreateForm } from "@/components/member-create-form";
import type { TerminologyState } from "@/lib/terminology/keys";

const SWIM_TERMINOLOGY: TerminologyState = {
  overrides: {
    member: { en: { one: "swimmer", other: "swimmers" } },
  },
  locale: "en",
};

afterEach(cleanup);

describe("MemberCreateForm — vocabulary (F18)", () => {
  it("renders the submit action and consent labels in tenant vocabulary", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "l1", name: "Main" }]}
        terminology={SWIM_TERMINOLOGY}
      />,
    );

    expect(screen.getByTestId("submit-member").textContent).toContain("swimmer");
    expect(screen.getByTestId("submit-member").textContent).not.toContain("member");

    const text = document.body.textContent ?? "";
    expect(text).toContain("This swimmer has agreed to data processing");
    expect(text).not.toMatch(/this member has agreed/i);
  });

  it("renders the guardian relationship placeholder in tenant vocabulary", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "l1", name: "Main" }]}
        terminology={SWIM_TERMINOLOGY}
      />,
    );

    // Open the minor/guardian branch so the relationship input mounts.
    fireEvent.change(screen.getByTestId("member-dob"), {
      target: { value: "2015-01-01" },
    });

    const relationship = screen.getByTestId("guardian-relationship");
    expect(relationship.getAttribute("placeholder")).toBe(
      "Relationship to swimmer (e.g. mother, father)",
    );
  });
});
