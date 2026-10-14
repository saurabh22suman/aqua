// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemberStatusPanel } from "@/components/member-status-panel";

const mocks = vi.hoisted(() => ({ change: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ transitionMemberStatusAction: mocks.change }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("releases a failed status mutation and asks the operator to reconcile before retrying", async () => {
  mocks.change.mockRejectedValueOnce(new Error("Lost response"));
  const view = render(<MemberStatusPanel memberId="member" status="active" canWrite />);
  fireEvent.click(view.getByRole("button", { name: /Move to Paused/i }));
  fireEvent.change(view.getByLabelText("Reason for status change"), { target: { value: "Synthetic reason" } });
  fireEvent.click(view.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("check its status"));
  expect(view.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(false);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
