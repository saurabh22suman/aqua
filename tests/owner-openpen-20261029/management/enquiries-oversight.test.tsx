// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Enquiries is owner OVERSIGHT: a "Current enquiries" surface whose
// aligned columns are Person / Source / Current stage / action, with one
// row action that opens the enquiry. Routine capture stays a secondary
// disclosure below the list, because reception owns day-to-day capture.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["enquiries.read", "enquiries.write"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/actions/enquiries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/actions/enquiries")>(
    "@/lib/actions/enquiries",
  );
  return {
    ...actual,
    listEnquiriesAction: async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fullName: "Meera Nair",
        phone: "+919000000103",
        source: "online",
        stage: "contacted",
        locationId: "loc-1",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        fullName: "Isha Rao",
        phone: null,
        source: "referral",
        stage: "new",
        locationId: null,
      },
    ],
    createEnquiryAction: async () => {
      throw new Error("not used");
    },
  };
});

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));

import EnquiriesPage from "@/app/(owner)/owner/enquiries/page";

afterEach(cleanup);

describe("owner enquiry oversight", () => {
  it("renders current enquiries as an aligned table with one row action", async () => {
    render(await EnquiriesPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "Current enquiries" }),
    ).toBeTruthy();

    const table = screen.getByRole("table", { name: "Current enquiries" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Person", "Source", "Current stage", "Actions"]);

    expect(within(table).getByText("Meera Nair")).toBeTruthy();
    expect(within(table).getByText("Contacted")).toBeTruthy();
    expect(within(table).getByText("New")).toBeTruthy();
    expect(
      within(table)
        .getByRole("link", { name: "Open Meera Nair" })
        .getAttribute("href"),
    ).toBe("/owner/enquiries/11111111-1111-4111-8111-111111111111");
  });

  it("keeps capture as a secondary disclosure below oversight", async () => {
    render(await EnquiriesPage());

    const capture = screen.getByRole("button", {
      name: "Capture an enquiry when covering reception",
    });
    expect(capture.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Quick capture")).toBeNull();

    fireEvent.click(capture);
    expect(screen.getByText("Quick capture")).toBeTruthy();
  });
});
