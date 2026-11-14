// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MemberListRow } from "@/lib/services/people";

const search = vi.fn();
vi.mock("@/lib/actions/people", () => ({ listMembersAction: (...args: unknown[]) => search(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { MembersBoard } from "@/components/members-board";

afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("announces the newest settled search count without moving focus or reporting stale results", async () => {
  let finishOld!: (rows: MemberListRow[]) => void;
  search.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  search.mockResolvedValueOnce([]);
  render(<MembersBoard initialMembers={[]} />);
  const input = screen.getByLabelText("Search members");
  input.focus();
  fireEvent.change(input, { target: { value: "older" } });
  fireEvent.change(input, { target: { value: "latest" } });
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("0 records"));
  expect(document.activeElement).toBe(input);
  await act(async () => finishOld([{ memberId: "stale", fullName: "Stale", memberCode: "1", locationName: "A", status: "active", phone: null, isMinor: false } as MemberListRow]));
  expect(screen.getByRole("status").textContent).toContain("0 records");
  expect(screen.queryByText("Stale")).toBeNull();
});
it("uses the tenant member override in the directory search label", () => {
  render(<MembersBoard initialMembers={[]} terminology={{locale:"en",overrides:{member:{en:{one:"player",other:"players"}}}}} />);
  expect(screen.getByLabelText("Search players")).toBeTruthy();
});
