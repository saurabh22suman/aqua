// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// India-first item 6 — the OWNED new-staff page passes the approved
// staff-candidate search action into the picker. Rendered consumer checks:
// real search wiring, explicit identity selection, empty and failed search.

const searchStaffCandidatesAction = vi.hoisted(() => vi.fn());
const createStaffAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/staff", () => ({
  searchStaffCandidatesAction,
  createStaffAction,
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["staff.write"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import StaffCreatePage from "@/app/(owner)/owner/staff/new/page";

afterEach(() => {
  cleanup();
  searchStaffCandidatesAction.mockReset();
  createStaffAction.mockReset();
});

async function openExisting() {
  render(await StaffCreatePage());
  fireEvent.click(screen.getByRole("button", { name: /existing person/i }));
}

describe("new staff page candidate wiring", () => {
  it("searches, shows the chosen identity and sends the existing person", async () => {
    searchStaffCandidatesAction.mockResolvedValue([
      { personId: "person-1", fullName: "Asha Rao", phone: "90000 00101" },
    ]);
    createStaffAction.mockResolvedValue({ kind: "ok", staffId: "s1" });
    await openExisting();

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: /find a person by name or phone/i,
      }),
      { target: { value: "Asha" } },
    );

    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(searchStaffCandidatesAction).toHaveBeenCalledWith("Asha");

    fireEvent.click(screen.getByRole("button", { name: /Asha Rao/ }));
    expect(screen.getByTestId("staff-person-preview").textContent).toContain(
      "+91 90000 00101",
    );

    fireEvent.click(screen.getByTestId("staff-save"));
    await waitFor(() =>
      expect(createStaffAction).toHaveBeenCalledWith({
        staffType: "coach",
        existingPersonId: "person-1",
      }),
    );
  });

  it("shows an honest empty state for no matches", async () => {
    searchStaffCandidatesAction.mockResolvedValue([]);
    await openExisting();

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: /find a person by name or phone/i,
      }),
      { target: { value: "Nobody" } },
    );
    expect(await screen.findByText(/No matching person/i)).toBeTruthy();
    expect(screen.queryByTestId("staff-person-preview")).toBeNull();
  });

  it("shows a search failure without inventing a selection", async () => {
    searchStaffCandidatesAction.mockRejectedValue(new Error("offline"));
    await openExisting();

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: /find a person by name or phone/i,
      }),
      { target: { value: "Asha" } },
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Could not search people"),
    );
    expect(screen.queryByTestId("staff-person-preview")).toBeNull();
  });
});
