// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — inline member edits are
// field-scoped. Each commit sends only the field the user touched, so
// saving field B can never overwrite a successful save to field A
// with a stale full-record snapshot.

const updateMemberAction = vi.hoisted(() => vi.fn());
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
  medicalNotes: "Asthma inhaler in bag",
} as const;

afterEach(() => {
  cleanup();
  updateMemberAction.mockReset();
});

describe("InlineEditField field-scoped commits (P1)", () => {
  it("sends only the edited name — no stale phone/DOB/location snapshot", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    const input = screen.getByDisplayValue("Arjun Mehta") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Arjun Kumar" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    expect(updateMemberAction).toHaveBeenCalledWith({
      memberId: "m1",
      fullName: "Arjun Kumar",
    });
  });

  it("editing the phone after a name save cannot revert the name", async () => {
    updateMemberAction.mockResolvedValue({ ok: true });
    render(
      <InlineEditField
        value="9876500001"
        field="phone"
        memberId="m1"
        type="text"
        formatAs="phone"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit phone/i }));
    const input = screen.getByDisplayValue("9876500001") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9876500009" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledTimes(1));
    // The stale snapshot name/DOB must not be part of the payload.
    const payload = updateMemberAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ memberId: "m1", phone: "9876500009" });
    expect("fullName" in payload).toBe(false);
    expect("dateOfBirth" in payload).toBe(false);
    expect("locationId" in payload).toBe(false);
  });

  it("reflects the persisted value the server reports (phone cleared)", async () => {
    updateMemberAction.mockResolvedValue({
      ok: true,
      value: { memberId: "m1", phone: null },
    });
    render(
      <InlineEditField
        value="9876500001"
        field="phone"
        memberId="m1"
        type="text"
        formatAs="phone"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit phone/i }));
    const input = screen.getByDisplayValue("9876500001") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateMemberAction).toHaveBeenCalledWith({
      memberId: "m1",
      phone: null,
    }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeTruthy());
  });

  it("keeps the attempted draft after a rejected save so it can be retried", async () => {
    updateMemberAction.mockResolvedValue({ ok: false, error: "Name is required" });
    render(
      <InlineEditField
        value="Arjun Mehta"
        field="fullName"
        memberId="m1"
        type="text"
        snapshot={SNAPSHOT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    const input = screen.getByDisplayValue("Arjun Mehta") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bad Name" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Name is required"));
    // The display rolled back to the stored value…
    expect(screen.getByText("Arjun Mehta")).toBeTruthy();
    // …and re-entering edit mode restores the attempted draft.
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    expect(screen.getByDisplayValue("Bad Name")).toBeTruthy();
  });
});
