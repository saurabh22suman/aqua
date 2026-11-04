// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the Add member journey.
//
// Contract (owner-light-implementation-20261102/CONTRACT.md, bullet 8):
// "Add goes to real add form" and "without resetting unsaved work".
//
// The shared create action on the directory points at
// /owner/members/new. This file proves that destination is the REAL
// member form: it writes through the real create action and lands on
// the new member's profile, and a refused save keeps the typed details.
//
// No database: the create action is a local stub.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createMemberAction = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  createMemberAction: (...args: unknown[]) => createMemberAction(...args),
  searchPersonsAction: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn() }),
}));

import { MemberCreateForm } from "@/components/member-create-form";

const LOCATIONS = [{ id: "loc-1", name: "Main" }];
const TERMINOLOGY = { locale: "en", overrides: {} } as never;

beforeAll(() => {
  // jsdom has no layout engine; the form scrolls a failed field into view.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

beforeEach(() => {
  createMemberAction.mockReset();
  push.mockReset();
  createMemberAction.mockResolvedValue({ ok: true, memberId: "new-member-id" });
});

afterEach(() => {
  cleanup();
});

describe("owner Add member form", () => {
  // NEGATIVE CONTROL — the add form is the real form: it writes through
  // the real create action and opens the new member's profile.
  it("saves the member and opens the new profile", async () => {
    render(
      <MemberCreateForm
        locations={LOCATIONS}
        initialLocationId="loc-1"
        cancelHref="/owner/members"
        terminology={TERMINOLOGY}
      />,
    );

    fireEvent.change(screen.getByTestId("member-full-name"), {
      target: { value: "Aadhya Sharma" },
    });
    fireEvent.change(screen.getByTestId("member-dob"), {
      target: { value: "01/01/1990" },
    });
    fireEvent.click(screen.getByTestId("consent-checkbox"));
    fireEvent.click(screen.getByTestId("submit-member"));

    await waitFor(() => expect(createMemberAction).toHaveBeenCalled());
    expect(createMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Aadhya Sharma",
        dateOfBirth: "1990-01-01",
        locationId: "loc-1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/owner/members/new-member-id"));
  });

  // NEGATIVE CONTROL — a refused save is explained and NOTHING the owner
  // typed is thrown away.
  it("refuses a save without consent and keeps the typed details", async () => {
    render(
      <MemberCreateForm
        locations={LOCATIONS}
        initialLocationId="loc-1"
        cancelHref="/owner/members"
        terminology={TERMINOLOGY}
      />,
    );

    fireEvent.change(screen.getByTestId("member-full-name"), {
      target: { value: "Aadhya Sharma" },
    });
    fireEvent.change(screen.getByTestId("member-dob"), {
      target: { value: "01/01/1990" },
    });
    fireEvent.click(screen.getByTestId("submit-member"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/consent/i);
    expect(createMemberAction).not.toHaveBeenCalled();
    expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe(
      "Aadhya Sharma",
    );
  });
});
