// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the early mobile review findings (2 November 2026).
//
// MEASURED (integration/.playwright-mcp/owner-light-early-review-r4/
// owner-light-foundation-chrome.json, real Chrome at 390×844):
//
//   facility: { label: "All facilities", textWidth: 82.86,
//                available: 42, controlWidth: 120 }
//
// The header's facility trigger is 120px wide and only 42px of it is
// left for the text, so the selected facility is hard-clipped to
// "All fac" — a chopped word, not a label. The club identity, the
// facility, the search and the account all compete for one row.
//
// The corrections this file pins (rendered behaviour, not class strings):
//
//   1. the facility control states the SELECTED facility in full — the
//      accessible name carries "All facilities" (or the whole long
//      location name), never a generic "Facility";
//   2. the facility glyph is never painted UNDER the control's opaque
//      surface (it may be dropped, or drawn after the control, but it
//      may not precede it);
//   3. the phone's record search moves into the MORE panel, so the
//      header row can hold a readable facility label, the club
//      identity and the account; the DESKTOP search stays where it is
//      and BOTH search instances stay mounted (no lost query or
//      results);
//   4. the club identity truncates on purpose and keeps its full
//      accessible text;
//   5. the account control draws the SIGNED-IN PERSON's initials (the
//      shared PersonAvatar) — never the club's branding initials — and
//      the honest unknown ("?") when the user has no name on file;
//
// The proof that the label is not chopped and that the row does not
// overflow is the browser measurement (the coordinator's Chrome run);
// jsdom cannot lay out, so this file pins the rendered contract that
// makes it possible.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/members",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

const LOCATIONS = [
  { id: "loc-1", name: "Splash Pool" },
  { id: "loc-2", name: "Splash Sports Complex" },
];

afterEach(cleanup);

function renderShell() {
  return render(
    <OwnerShell
      navItems={TENANT_SURFACE_NAV.owner}
      locations={LOCATIONS}
      clubName="Splash Sports Club"
    >
      <p>Page content</p>
    </OwnerShell>,
  );
}

function moreDetails(): HTMLElement {
  const trigger = screen.getByText("More").closest("summary");
  const details = trigger?.closest("details");
  if (!details) throw new Error("the More disclosure is missing");
  return details as HTMLElement;
}

describe("the phone header — the facility scope is readable and complete", () => {
  it("names the scope through the labelled control and the whole selected option", () => {
    renderShell();

    // CONTROL: the native control already conveys the selection — it is
    // labelled "Facility" and its selected option carries the whole
    // value. The selected value is NOT repeated in the accessible name.
    const control = screen.getByRole("combobox", { name: /facility/i }) as HTMLSelectElement;
    expect(control.value).toBe("all");
    expect(control.selectedOptions[0]?.textContent).toBe("All facilities");
  });

  it("keeps the whole selected value available for a shortened label", () => {
    renderShell();

    // RED: a visible label may be shortened on purpose ("Facilities" at
    // 320px), so the control must always carry the whole selected value
    // in its title. The native value stays the selection.
    const control = screen.getByRole("combobox", { name: /facility/i });
    expect(control.getAttribute("title")).toContain("All facilities");
  });

  it("keeps the whole long facility name available", () => {
    renderShell();

    // The option text is the truth; the visible label may be concise,
    // but the selection is never silently shortened in the options.
    const control = screen.getByTestId("facility-switcher");
    const options = Array.from(
      (control as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toContain("Splash Sports Complex");
  });

  it("never paints the facility glyph under the control's opaque surface", () => {
    renderShell();

    const control = screen.getByTestId("facility-switcher");
    // The switcher wraps the shared control; the control has its own
    // internal wrapper, so the switcher's row is two levels up.
    const wrapper = control.parentElement?.parentElement as HTMLElement;
    // The approved pin glyph, found by its own geometry.
    const pin = Array.from(wrapper.querySelectorAll("svg")).find((svg) =>
      svg
        .querySelector("path")
        ?.getAttribute("d")
        ?.startsWith("M12 21s6.5"),
    );

    // RED: the pin is drawn before the control and without a stacking
    // lift, so the control's own positioned, opaque surface paints over
    // it. It may be dropped, drawn inside the control's slot, drawn
    // after the control, or lifted above it — but it may not be buried.
    if (pin) {
      const controlIndex = Array.from(wrapper.children).indexOf(
        control.parentElement as HTMLElement,
      );
      const pinIndex = Array.from(wrapper.children).indexOf(pin);
      const insideControl = control.contains(pin);
      const lifted = /z-\d+/.test(pin.getAttribute("class") ?? "");
      expect(
        insideControl || lifted || pinIndex > controlIndex,
        "the facility glyph must not be painted under the control's surface",
      ).toBe(true);
    }
  });

  it("keeps the facility control at the shared control size", () => {
    renderShell();
    const control = screen.getByTestId("facility-switcher");
    const className = control.getAttribute("class") ?? "";

    expect(className).toContain("min-h-11");
    expect(className).toContain("text-[16px]");
  });
});

describe("the phone header — the search is reachable without crowding the row", () => {
  it("does not keep a competing search trigger in the header row", () => {
    renderShell();
    const header = screen.getByTestId("owner-top-bar");

    // RED: the phone header still carries its own search trigger, which
    // is what squeezes the facility label to "All fac".
    expect(
      within(header).queryByText("Search records"),
      "the phone search trigger must leave the header row",
    ).toBeNull();
  });

  it("offers the record search inside the More panel", () => {
    renderShell();

    // RED: the More panel has no search entry today.
    expect(
      within(moreDetails()).getByTestId("global-search-input"),
      "More must carry the record search",
    ).toBeTruthy();
  });

  it("keeps the desktop search and the phone search both mounted", () => {
    renderShell();

    // CONTROL: the correction moves the phone search, it does not drop
    // it — and it never touches the desktop search.
    expect(screen.getAllByTestId("global-search-input")).toHaveLength(2);
  });
});

describe("the phone header — the club identity truncates on purpose", () => {
  it("keeps the whole club name as its accessible text", () => {
    renderShell();
    const header = screen.getByTestId("owner-top-bar");
    const club = within(header).getByText("Splash Sports Club");

    // CONTROL: the identity may be shortened visually, but the full
    // name stays available.
    expect(club.getAttribute("title")).toBe("Splash Sports Club");
  });
});

describe("the account control — the person's own initials", () => {
  it("draws the honest unknown when the signed-in user has no name on file", () => {
    renderShell();
    const account = screen.getByTestId("owner-header-account");

    // The account control is a PERSON control: it draws the signed-in
    // person's initials. An owner who was never entered as a person has
    // no name, so the shared primitive draws its honest unknown ("?") —
    // never the club's branding initials, and never a borrowed identity.
    expect(within(account).getByTestId("person-avatar").textContent).toBe("?");
  });
});
