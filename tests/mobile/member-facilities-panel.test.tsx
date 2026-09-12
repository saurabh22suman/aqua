// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Wave 2, slice 4 — member facility opt-in UI on the member detail
// page. Home facility is shown read-only; opted facilities can be
// ended; remaining facilities can be added. TDD: fails before the
// component exists.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
const addAction = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const endAction = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("@/lib/actions/facility-optins", () => ({
  addMemberFacilityAction: addAction,
  endMemberFacilityAction: endAction,
}));

import { MemberFacilitiesPanel } from "@/components/member-facilities-panel";

const HOME = { id: "11111111-1111-7111-8111-111111111111", name: "Home Pool" };
const OPTED = {
  optinId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  locationId: "22222222-2222-7222-8222-222222222222",
  locationName: "Second Pool",
  optedOn: "2026-09-01",
};
const THIRD = { id: "33333333-3333-7333-8333-333333333333", name: "Third Pool" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemberFacilitiesPanel (Wave 2)", () => {
  it("shows the home facility and the opted facilities", () => {
    render(
      <MemberFacilitiesPanel
        memberId="m1"
        home={HOME}
        opted={[OPTED]}
        locations={[HOME, THIRD]}
      />,
    );
    expect(document.body.textContent).toContain("Home Pool");
    expect(document.body.textContent).toContain("Second Pool");
    expect(document.body.textContent).toContain("Home");
  });

  it("ends an opt-in through the action", async () => {
    render(
      <MemberFacilitiesPanel
        memberId="m1"
        home={HOME}
        opted={[OPTED]}
        locations={[HOME, THIRD]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /end/i }));
    expect(endAction).toHaveBeenCalledWith({ optinId: OPTED.optinId });
  });

  it("adds a facility through the action", async () => {
    render(
      <MemberFacilitiesPanel
        memberId="m1"
        home={HOME}
        opted={[OPTED]}
        locations={[HOME, THIRD]}
      />,
    );
    fireEvent.change(screen.getByTestId("facility-add-picker"), {
      target: { value: THIRD.id },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(addAction).toHaveBeenCalledWith({ memberId: "m1", locationId: THIRD.id });
  });

  it("does not offer the home or already-opted facility again", () => {
    render(
      <MemberFacilitiesPanel
        memberId="m1"
        home={HOME}
        opted={[OPTED]}
        locations={[HOME, OPTED, THIRD].map((l) => ({
          id: "locationId" in l ? l.locationId : l.id,
          name: "locationName" in l ? l.locationName : l.name,
        }))}
      />,
    );
    const options = Array.from(
      (screen.getByTestId("facility-add-picker") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual([THIRD.id]);
  });
});
