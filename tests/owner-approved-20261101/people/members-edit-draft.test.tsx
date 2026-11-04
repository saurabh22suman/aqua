// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ update: vi.fn(async () => ({ ok: false, error: "Could not save changes" })), push: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: actions.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push, refresh: vi.fn() }) }));
import { MemberEditForm } from "@/components/member-edit-form";

const member = { memberId: "member-1", fullName: "Test Member", phone: null, dateOfBirth: "1990-01-01", joinedOn: "2026-08-01", gender: null, locationId: "loc-1", medicalNotes: null } as never;
const locations = [{ id: "loc-1", name: "Main" }, { id: "loc-2", name: "Annex" }];
afterEach(() => { cleanup(); actions.update.mockClear(); actions.push.mockClear(); });

it("asks before discarding a changed edit and keeps the draft when editing continues", () => {
  render(<MemberEditForm member={member} locations={locations} />);
  const name = screen.getByLabelText("Full name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Updated Member" } });
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  const dialog = screen.getByRole("dialog", { name: /discard changes/i });
  expect(actions.update).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: /keep editing/i }));
  expect(screen.queryByRole("dialog", { name: /discard changes/i })).toBeNull();
  expect(name.value).toBe("Updated Member");
  expect(actions.push).not.toHaveBeenCalled();
});

it("retains an edited name and facility when a save is refused", async () => {
  render(<MemberEditForm member={member} locations={locations} />);
  const name = screen.getByLabelText("Full name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Updated Member" } });
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "loc-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not save changes"));
  expect(name.value).toBe("Updated Member");
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("loc-2");
  expect(actions.update).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-1", fullName: "Updated Member", locationId: "loc-2" }));
  expect(actions.push).not.toHaveBeenCalled();
});

it("confirms discard and navigates to the selected profile without saving", () => {
  render(<MemberEditForm member={member} locations={locations} />);
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Updated Member" } });
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  const dialog = screen.getByRole("dialog", { name: /discard changes/i });
  fireEvent.click(within(dialog).getByRole("button", { name: /discard changes/i }));
  expect(actions.update).not.toHaveBeenCalled();
  expect(actions.push).toHaveBeenCalledWith("/owner/members/member-1");
});

it("offers a direct profile link when the edit has no changes", () => {
  render(<MemberEditForm member={member} locations={locations} />);
  expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/owner/members/member-1");
  expect(screen.queryByRole("dialog", { name: /discard changes/i })).toBeNull();
});
