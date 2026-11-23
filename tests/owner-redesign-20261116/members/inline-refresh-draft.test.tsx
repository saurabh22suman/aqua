// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: update }));
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
afterEach(() => { cleanup(); update.mockReset(); });
it("keeps an unsaved explicit draft across canonical refresh and cancels to the refreshed value", () => {
  const { rerender } = render(<InlineEditField memberId="m" field="fullName" type="text" value="Original" explicitCommit />);
  fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "My unsaved draft" } });
  rerender(<InlineEditField memberId="m" field="fullName" type="text" value="Refreshed saved name" explicitCommit />);
  expect(screen.getByLabelText("name")).toHaveProperty("value", "My unsaved draft");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Refreshed saved name")).toBeTruthy();
  expect(update).not.toHaveBeenCalled();
});
