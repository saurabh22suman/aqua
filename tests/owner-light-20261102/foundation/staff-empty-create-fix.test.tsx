// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the empty Staff directory offers ONE create affordance.
//
// Owner Staff is the only consumer of StaffBoard, and the page now supplies
// the shared OwnerCreateAction when the owner may write staff. The board's
// empty state also drew its own "Add your first staff member" link to the
// same form — a duplicate of the writer's action, and an exposed create
// affordance on a staff.read-only empty view. The empty state keeps its
// title, its body and its icon; the ACTION is gone.
//
// RED PROVENANCE: written BEFORE the production edit. The empty board
// really renders `/owner/staff/new` today, so the first assertion below
// fails on the rendered duplicate, not on a missing module.

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

import { StaffBoard } from "@/components/staff-board";
import type { StaffRow } from "@/lib/services/staff";

afterEach(cleanup);

describe("an empty Staff directory", () => {
  it("says there is no staff yet and offers no second create link", () => {
    render(<StaffBoard rows={[]} />);

    // The guidance stays.
    expect(screen.getByText("No staff yet")).toBeTruthy();
    expect(
      screen.getByText(/Add the people who run the academy/i),
    ).toBeTruthy();

    // RED: the empty state's own create link duplicates the page's shared
    // action and shows a create affordance to a read-only viewer.
    expect(
      document.querySelector('a[href="/owner/staff/new"]'),
      "the empty directory must not carry its own create link",
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /Add your first staff member/i })).toBeNull();
  });
});

describe("a populated Staff directory (control)", () => {
  it("keeps the directory rows and their profile links", () => {
    const rows = [
      {
        id: "s1",
        personId: "person-1",
        fullName: "Asha Rao",
        userId: null,
        staffType: "coach",
        employedOn: null,
      },
    ] as unknown as StaffRow[];
    render(<StaffBoard rows={rows} />);

    expect(screen.getByRole("table", { name: "Team directory" })).toBeTruthy();
    expect(
      document.querySelector('a[href="/owner/staff/s1"]'),
      "a populated row still opens its matching staff profile",
    ).toBeTruthy();
    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
  });
});
