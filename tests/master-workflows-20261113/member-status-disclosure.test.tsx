// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const transition = vi.fn();
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/lib/actions/people", () => ({transitionMemberStatusAction: (...args: unknown[]) => transition(...args)}));
import { MemberStatusPanel } from "@/components/member-status-panel";
afterEach(() => {cleanup(); vi.resetAllMocks();});
it("groups rare status changes while retaining the required reason and confirmation", () => {
  render(<MemberStatusPanel memberId="m" status="active" canWrite />);
  const disclosure = screen.getByText("Change participation status");
  expect(disclosure).toBeTruthy();
  fireEvent.click(disclosure);
  fireEvent.click(screen.getByRole("button", {name:"Move to Paused"}));
  fireEvent.click(screen.getByRole("button", {name:"Confirm"}));
  expect(screen.getByRole("alert").textContent).toContain("reason");
  expect(transition).not.toHaveBeenCalled();
});
it("leads with separate participation, plan and scoped balance information even for a reader", () => {
  render(<MemberStatusPanel memberId="m" status="active" canWrite={false} summary={{plans:[{name:"Monthly",status:"paused"}],balance:"₹125.00"}} />);
  expect(screen.getByText(/participation.*active/i)).toBeTruthy();
  expect(screen.getByText(/Monthly.*paused/i)).toBeTruthy();
  expect(screen.getByText(/outstanding.*125/i)).toBeTruthy();
  expect(screen.queryByText("Change participation status")).toBeNull();
});
it("never renders a failed or unauthorized balance as zero", () => {
  const view = render(<MemberStatusPanel memberId="m" status="active" canWrite={false} summary={{plans:null,balance:null}} />);
  expect(screen.getByText(/membership plan: unavailable/i)).toBeTruthy();
  expect(screen.getByText(/outstanding: unavailable/i)).toBeTruthy();
  view.rerender(<MemberStatusPanel memberId="m" status="active" canWrite={false} summary={{plans:[]}} />);
  expect(screen.queryByText(/outstanding/i)).toBeNull();
});
