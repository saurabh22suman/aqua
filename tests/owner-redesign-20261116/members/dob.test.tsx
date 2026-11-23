// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: vi.fn() }));
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
afterEach(cleanup);

it("shows a day-first DOB and an explicit touch editing control, opening the date editor", () => {
  render(<InlineEditField value="2002-03-14" field="dateOfBirth" memberId="m" type="text" alwaysShowEdit />);
  expect(screen.getByText("14 Mar 2002")).toBeTruthy();
  const edit = screen.getByRole("button", { name: "Edit date of birth" });
  expect(edit.textContent).toContain("Edit");
  fireEvent.click(edit);
  expect(screen.getByLabelText("date of birth")).toHaveProperty("placeholder", "dd/mm/yyyy");
});
