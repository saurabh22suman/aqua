// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ createMemberAction: actions.create, searchPersonsAction: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push, refresh: vi.fn() }) }));
import { MemberCreateForm } from "@/components/member-create-form";
afterEach(() => { cleanup(); actions.create.mockClear(); actions.push.mockClear(); });
it("protects a new-member draft on Cancel and keeps it without submitting", () => {
  render(<MemberCreateForm locations={[{ id: "loc-1", name: "Main" }]} terminology={{ locale: "en", overrides: {} }} />);
  const input = screen.getByTestId("member-full-name") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Synthetic draft" } });
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  const dialog = screen.getByRole("dialog", { name: /discard changes/i });
  fireEvent.click(within(dialog).getByRole("button", { name: /keep editing/i }));
  expect(input.value).toBe("Synthetic draft");
  expect(actions.create).not.toHaveBeenCalled();
  expect(actions.push).not.toHaveBeenCalled();
});
it("confirms discarding a new draft without creating a member", () => {
  render(<MemberCreateForm locations={[{ id: "loc-1", name: "Main" }]} terminology={{ locale: "en", overrides: {} }} />);
  fireEvent.change(screen.getByTestId("member-full-name"), { target: { value: "Synthetic draft" } });
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: /discard changes/i })).getByRole("button", { name: /discard changes/i }));
  expect(actions.create).not.toHaveBeenCalled();
  expect(actions.push).toHaveBeenCalledWith("/owner/members");
});
