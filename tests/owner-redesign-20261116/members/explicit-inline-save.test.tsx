// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: update }));
import { InlineEditField } from "@/components/member-detail/inline-edit-field";

beforeEach(() => update.mockReset());
afterEach(cleanup);

describe("explicit member field editing", () => {
  it("does not write on blur; cancel and Escape discard drafts and restore focus", () => {
    render(<InlineEditField memberId="m" field="fullName" type="text" value="Old" explicitCommit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    const input = screen.getByLabelText("name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.blur(input);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Old")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Another" } });
    fireEvent.keyDown(screen.getByLabelText("name"), { key: "Escape" });
    expect(screen.getByText("Old")).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("disables editing and duplicate saves while pending and shows the server's canonical value", async () => {
    let resolve!: (value: unknown) => void;
    update.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<InlineEditField memberId="m" field="fullName" type="text" value="Old" explicitCommit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "  New Name  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("name")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ memberId: "m", fullName: "New Name" });
    await act(async () => resolve({ ok: true, value: { fullName: "Canonical Name" } }));
    expect(screen.getByText("Canonical Name")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit name" }));
  });

  it("retains a rejected draft and permits retry", async () => {
    update.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({ ok: true, value: { phone: "9876543210" } });
    render(<InlineEditField memberId="m" field="phone" type="text" value="123" explicitCommit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit phone number" }));
    fireEvent.change(screen.getByLabelText("phone number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Network error");
    expect(screen.getByLabelText("phone number")).toHaveProperty("value", "9876543210");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("9876543210")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("retains the draft on a server refusal and cancel restores the saved value", async () => {
    update.mockResolvedValue({ ok: false, error: "Not allowed" });
    render(<InlineEditField memberId="m" field="medicalNotes" type="textarea" value="Existing" explicitCommit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit medical notes" }));
    fireEvent.change(screen.getByLabelText("medical notes"), { target: { value: "Draft notes" } });
    fireEvent.blur(screen.getByLabelText("medical notes"));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Not allowed");
    expect(screen.getByLabelText("medical notes")).toHaveProperty("value", "Draft notes");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Existing")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("requires Save for select changes", async () => {
    update.mockResolvedValue({ ok: true, value: { gender: "female" } });
    render(<InlineEditField memberId="m" field="gender" type="select" value="male" explicitCommit options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit gender" }));
    fireEvent.change(screen.getByLabelText("gender"), { target: { value: "female" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ memberId: "m", gender: "female" }));
  });

  it("requires Save for a date and refuses an incomplete date", async () => {
    update.mockResolvedValue({ ok: true, value: { dateOfBirth: "2001-04-15" } });
    render(<InlineEditField memberId="m" field="dateOfBirth" type="date" value="2002-03-14" explicitCommit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit date of birth" }));
    const input = screen.getByLabelText("date of birth");
    fireEvent.change(input, { target: { value: "15/04/2001" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ memberId: "m", dateOfBirth: "2001-04-15" }));
    await screen.findByText("15 Apr 2001");
    fireEvent.click(screen.getByRole("button", { name: "Edit date of birth" }));
    fireEvent.change(screen.getByLabelText("date of birth"), { target: { value: "15/04" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
