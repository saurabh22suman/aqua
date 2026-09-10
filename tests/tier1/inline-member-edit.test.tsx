// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Member-detail inline edit (TDD). Same server-action mocking shape
// as tests/tier1/branding.test.ts and the offline hook tests:
// vi.mock the actions module, drive the component through DOM events,
// assert on the rendered output. Mutation: the success path mock is
// flipped to throw mid-suite to prove the rollback works for both the
// typed-error (action returns { ok: false }) and thrown-error paths.

const updateMemberAction = vi.fn();
vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: (...args: unknown[]) => updateMemberAction(...args),
}));

import { InlineEditField } from "@/components/member-detail/inline-edit-field";

const SNAPSHOT = {
  fullName: "Arjun Mehta",
  dateOfBirth: "2015-01-01",
  locationId: "11111111-1111-1111-1111-111111111111",
  phone: "9876500001",
  gender: "male",
  medicalNotes: null,
} as const;

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

// Plain-DOM assertions — the project does not pull in
// @testing-library/jest-dom, and adding a dependency just for this
// file would violate the "no new dependency" rule on the PR.
function expectInDocument(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(document.body.contains(el)).toBe(true);
}

function expectNotInDocument(el: HTMLElement | null): void {
  if (el === null) return;
  expect(document.body.contains(el)).toBe(false);
}

describe("InlineEditField", () => {
  afterEach(() => {
    cleanup();
    updateMemberAction.mockReset();
  });

  it("renders the value as text by default", () => {
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    expectInDocument(screen.getByText("Arjun Mehta"));
    // The input is not in the DOM until edit mode is entered.
    expectNotInDocument(screen.queryByDisplayValue("Arjun Mehta"));
  });

  it("clicking the pencil switches to input mode", () => {
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue("Arjun Mehta");
    expectInDocument(input);
    expect(input.tagName).toBe("INPUT");
  });

  it("blurring calls updateMemberAction with the new value", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Arjun Kumar" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    expect(updateMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "m1",
        fullName: "Arjun Kumar",
      }),
    );
  });

  it("saving optimistically updates the displayed value", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Arjun Kumar" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expectInDocument(screen.getByText("Arjun Kumar")),
    );
    expectNotInDocument(screen.queryByDisplayValue("Arjun Kumar"));
  });

  it("save failure (action returns { ok: false }) rolls back and shows an inline error", async () => {
    updateMemberAction.mockResolvedValue({ ok: false, error: "Invalid name" });
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bad Name" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expectInDocument(screen.getByRole("alert")),
    );
    expect(screen.getByRole("alert").textContent).toBe("Invalid name");
    // Rollback: original value is displayed, new value is gone.
    expectInDocument(screen.getByText("Arjun Mehta"));
    expectNotInDocument(screen.queryByText("Bad Name"));
  });

  it("save failure (action throws) rolls back and shows an inline error — the mutation check", async () => {
    // Mutation proof: flip the success path to throw. If the catch
    // branch weren't wired, the displayed value would stay at the
    // optimistic "Anything" and no error would render — the suite
    // would still pass on the input/output plumbing. Both assertions
    // below trip if the rollback path is broken.
    updateMemberAction.mockRejectedValue(new Error("Network down"));
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Anything" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expectInDocument(screen.getByRole("alert")),
    );
    expect(screen.getByRole("alert").textContent).toBe("Network down");
    expectInDocument(screen.getByText("Arjun Mehta"));
    expectNotInDocument(screen.queryByText("Anything"));
  });

  it("date variant saves on change, not blur", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="2015-01-01"
        field="dateOfBirth"
        memberId="m1"
        type="date"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit dateOfBirth/i }));
    const input = screen.getByDisplayValue(
      "2015-01-01",
    ) as HTMLInputElement;
    // No blur — change alone is the commit trigger for date.
    fireEvent.change(input, { target: { value: "2014-12-31" } });
    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    expect(updateMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ dateOfBirth: "2014-12-31" }),
    );
  });

  it("select variant saves on change, not blur", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="male"
        field="gender"
        memberId="m1"
        type="select"
        options={GENDER_OPTIONS}
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit gender/i }));
    const select = screen.getByLabelText("gender") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "female" } });
    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    expect(updateMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ gender: "female" }),
    );
  });

  it("Enter on a text input commits the new value", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Arjun Kumar" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    expect(updateMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Arjun Kumar" }),
    );
  });

  it("Escape on a text input cancels without saving", () => {
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit fullName/i }));
    const input = screen.getByDisplayValue(
      "Arjun Mehta",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Arjun Kumar" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(updateMemberAction).not.toHaveBeenCalled();
    // Original value is displayed; edit mode is closed.
    expectInDocument(screen.getByText("Arjun Mehta"));
    expectNotInDocument(screen.queryByDisplayValue("Arjun Kumar"));
  });
});