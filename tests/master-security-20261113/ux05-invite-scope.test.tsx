// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/staff-invitations", () => ({ inviteStaffAction: vi.fn() }));
import { StaffInviteForm } from "@/components/staff-invite-form";

afterEach(cleanup);

it("requires an explicit scope and summarizes whole-academy access before inviting", () => {
  render(<StaffInviteForm locations={[{ id: "site-a", name: "Site A" }, { id: "site-b", name: "Site B" }]} />);
  const save = screen.getByTestId("invite-save") as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /whole academy, including future facilities/i }));
  expect(save.disabled).toBe(false);
  expect(screen.getByText(/coach.*whole academy.*future facilities/i)).toBeTruthy();
});

it("requires a named facility for selected access and summarizes it", () => {
  render(<StaffInviteForm locations={[{ id: "site-a", name: "Site A" }]} />);
  fireEvent.click(screen.getByRole("radio", { name: /selected facilities/i }));
  const save = screen.getByTestId("invite-save") as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Site A" }));
  expect(save.disabled).toBe(false);
  expect(screen.getByText(/coach.*site a/i)).toBeTruthy();
  expect(screen.getByText("Club-wide records without an assigned site may also be visible.")).toBeTruthy();
});
