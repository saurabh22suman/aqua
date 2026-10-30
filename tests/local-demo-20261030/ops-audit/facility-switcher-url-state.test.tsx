// @vitest-environment jsdom
//
// The REAL owner facility switcher (components/facility-switcher.tsx) —
// its URL/cookie contract and its Back-button behaviour.
//
// The human's scope: "For facility browser use real current switcher, URL
// over cookie and Back UI state; no new facility selector needed."
//
// The contract this file pins, against the real component (not a copy):
//
//   1. the URL wins over the cookie — a shared link with
//      `?facility=` is the scope, whatever the device remembers;
//   2. a page opened WITHOUT a facility in the URL adopts the remembered
//      cookie and puts it into the URL;
//   3. "All facilities" clears both the URL parameter and the cookie;
//   4. after a Back navigation that changes `?facility=`, the CONTROL
//      must show the URL's scope — the data on the page is scoped by the
//      URL, so a control that shows a different facility is lying.
//
// Case 4 is the one the existing suites do not cover: they only ever
// render with a constant `useSearchParams()`.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(search.get()),
}));

// The component reads the cookie from the document; the jsdom cookie jar
// is the device state.
const search = { get: () => "" };
const FACILITY_A = "11111111-1111-7111-8111-111111111111";
const FACILITY_B = "22222222-2222-7222-8222-222222222222";
const LOCATIONS = [
  { id: FACILITY_A, name: "Worli Main" },
  { id: FACILITY_B, name: "Bandra Annex" },
];

function setUrl(query: string) {
  search.get = () => query;
}

function setCookie(value: string | null) {
  document.cookie = `aqua_facility=; path=/; max-age=0; samesite=lax`;
  if (value) {
    document.cookie = `aqua_facility=${value}; path=/; max-age=31536000; samesite=lax`;
  }
}

function selectedFacility(): string {
  return (screen.getByLabelText("Facility") as HTMLSelectElement).value;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  setCookie(null);
  setUrl("");
});

describe("the real facility switcher", () => {
  it("offers All facilities plus every facility", () => {
    setUrl("");
    render(<SwitcherUnderTest locations={LOCATIONS} />);
    const options = Array.from(
      (screen.getByLabelText("Facility") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["all", FACILITY_A, FACILITY_B]);
  });

  it("shows the URL's facility even when the cookie remembers another one", () => {
    setCookie(FACILITY_A);
    setUrl(`facility=${FACILITY_B}`);
    render(<SwitcherUnderTest locations={LOCATIONS} />);
    expect(
      selectedFacility(),
      "the URL must win over the remembered cookie",
    ).toBe(FACILITY_B);
    expect(
      replace,
      "the URL already carries a facility: nothing may be replaced",
    ).not.toHaveBeenCalled();
  });

  it("adopts the remembered cookie when the URL carries no facility", () => {
    setCookie(FACILITY_A);
    setUrl("");
    render(<SwitcherUnderTest locations={LOCATIONS} />);
    expect(selectedFacility()).toBe(FACILITY_A);
    expect(replace).toHaveBeenCalledWith(`/owner/members?facility=${FACILITY_A}`);
  });

  it("writes the choice to the URL and the cookie, and 'all' clears both", () => {
    setUrl("");
    render(<SwitcherUnderTest locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText("Facility"), {
      target: { value: FACILITY_B },
    });
    expect(push).toHaveBeenCalledWith(`/owner/members?facility=${FACILITY_B}`);
    expect(document.cookie).toContain(`aqua_facility=${FACILITY_B}`);

    fireEvent.change(screen.getByLabelText("Facility"), {
      target: { value: "all" },
    });
    expect(push).toHaveBeenLastCalledWith("/owner/members");
    expect(document.cookie).not.toContain(`aqua_facility=${FACILITY_B}`);
  });

  it("follows the URL after a Back navigation", () => {
    setUrl("");
    const { rerender } = render(<SwitcherUnderTest locations={LOCATIONS} />);
    // The operator picks the second facility.
    fireEvent.change(screen.getByLabelText("Facility"), {
      target: { value: FACILITY_B },
    });
    expect(selectedFacility()).toBe(FACILITY_B);
    // …and then presses Back: the URL returns to the first facility. The
    // page's data is scoped by the URL, so the control must agree. A Back
    // navigation does NOT remount the component — it re-renders it with a
    // new search param — so any state the component kept must be synced.
    setUrl(`facility=${FACILITY_A}`);
    rerender(<SwitcherUnderTest locations={LOCATIONS} />);
    expect(
      selectedFacility(),
      "after a Back navigation the control must show the URL's facility, not the stale one",
    ).toBe(FACILITY_A);
  });
});

// Imported lazily so the module mocks above are in place first.
import { FacilitySwitcher } from "@/components/facility-switcher";

function SwitcherUnderTest(props: { locations: { id: string; name: string }[] }) {
  return <FacilitySwitcher {...props} />;
}
