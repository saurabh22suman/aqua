// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Multi-location business hours — every time control has exactly ONE owner.
//
// The owner locations page renders one business-hours editor per location
// (components/settings/location-manager.tsx -> BusinessHoursEditor), and the
// editor used to derive its TimeField ids from the weekday alone
// (`hours-${day}-open`). With two locations open on the same page BOTH
// editors emitted the same ids, and a native `<label for>` — and the help
// text an aria-describedby points at — name the FIRST element carrying that
// id. The second location's "Hour / Minutes / AM/PM" labels therefore drove
// the FIRST location's controls, and its help text was the other editor's.
//
// The contract these cases hold:
//   - every id in the document has exactly one owner;
//   - each editor's native labels resolve inside that editor;
//   - each editor's help references resolve inside that editor;
//   - the shared TimeField contract is unchanged: the group's accessible
//     name, the `hours-<day>-open` prefix the reviewer's journey selects,
//     and one editor's day switch do not reach the other editor.
//
// No server, no database, no credentials: the editor's server actions are
// mocked and nothing is saved.

const getBusinessHoursAction = vi.fn();
vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: vi.fn(),
  createLocationAction: vi.fn(),
  updateLocationAction: vi.fn(),
  getBusinessHoursAction: (...args: unknown[]) =>
    getBusinessHoursAction(...args),
  setBusinessHoursAction: vi.fn(),
}));

import { LocationManager } from "@/components/settings/location-manager";
import type { LocationAdminRow } from "@/lib/services/locations";

const WORLI: LocationAdminRow = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  name: "Worli",
  kind: "club",
  isPrimary: true,
  address: { city: "Mumbai" },
  createdAt: new Date().toISOString(),
};

const ANDHERI: LocationAdminRow = {
  ...WORLI,
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  name: "Andheri",
  isPrimary: false,
};

/** The location cards — each one carries its own weekly-hours editor. */
function editors(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("section")).filter((section) =>
    Array.from(section.querySelectorAll("h3")).some(
      (heading) => heading.textContent?.trim() === "Weekly hours",
    ),
  );
}

/** Every id in the tree, so a shared id can be named. */
function allIds(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[id]")).map(
    (element) => element.id,
  );
}

/** Two locations, each showing Monday's two time groups. */
async function renderTwoLocations() {
  getBusinessHoursAction.mockResolvedValue({
    days: [{ day: "monday", closed: false, open: "06:00", close: "21:00" }],
  });
  const view = render(<LocationManager initial={[WORLI, ANDHERI]} canWrite />);
  await waitFor(() => expect(editors(view.container)).toHaveLength(2));
  await waitFor(() =>
    expect(
      view.container.querySelectorAll("fieldset[id^='hours-monday-']"),
    ).toHaveLength(4),
  );
  return view;
}

afterEach(() => {
  cleanup();
  getBusinessHoursAction.mockReset();
});

describe("business hours across two locations", () => {
  it("gives every time control exactly one owner", async () => {
    const { container } = await renderTwoLocations();
    const ids = allIds(container);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicated).toEqual([]);
  });

  it("keeps each editor's native labels inside that editor", async () => {
    const { container } = await renderTwoLocations();
    for (const editor of editors(container)) {
      const labels = Array.from(
        editor.querySelectorAll<HTMLLabelElement>("label[for]"),
      );
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const target = document.getElementById(label.getAttribute("for") ?? "");
        expect(target).not.toBeNull();
        expect(editor.contains(target)).toBe(true);
      }
    }
  });

  it("keeps each editor's help text inside that editor", async () => {
    const { container } = await renderTwoLocations();
    for (const editor of editors(container)) {
      const described = Array.from(
        editor.querySelectorAll<HTMLElement>("[aria-describedby]"),
      );
      expect(described.length).toBeGreaterThan(0);
      for (const element of described) {
        const tokens = (element.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        expect(tokens.length).toBeGreaterThan(0);
        for (const token of tokens) {
          const target = document.getElementById(token);
          expect(target).not.toBeNull();
          expect(editor.contains(target)).toBe(true);
        }
      }
    }
  });

  it("keeps the shared TimeField contract and one editor's day switch", async () => {
    const { container } = await renderTwoLocations();

    // The group keeps its accessible name, once per location.
    expect(
      screen.getAllByRole("group", { name: /monday opening time/i }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("group", { name: /monday closing time/i }),
    ).toHaveLength(2);

    // The prefix the reviewer's journey selects is preserved.
    expect(
      container.querySelectorAll("fieldset[id^='hours-monday-open']"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("fieldset[id^='hours-monday-close']"),
    ).toHaveLength(2);

    // One editor's day switch does not reach the other editor.
    const [first, second] = editors(container);
    fireEvent.click(within(first).getByLabelText("monday open"));
    await waitFor(() =>
      expect(
        first.querySelectorAll("fieldset[id^='hours-monday-']"),
      ).toHaveLength(0),
    );
    expect(second.querySelectorAll("fieldset[id^='hours-monday-']")).toHaveLength(2);
  });
});
