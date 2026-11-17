// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MemberListRow } from "@/lib/services/people";
const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/people", () => ({ listMembersAction: search }));
import { MembersBoard } from "@/components/members-board";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const rows = ["active", "paused"].map((status, index) => ({ memberId: `m${index}`, personId: `p${index}`, fullName: `Person ${index}`, memberCode: `M${index}`, locationId: "site", locationName: "North", status, phone: null, isMinor: false, createdAt: "2026-01-01", joinedOn: "2026-01-01" })) as MemberListRow[];

it("shows only applied results and withholds counts on pending or failed reads", async () => {
  let finish!: (rows: MemberListRow[]) => void;
  search.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(new Error("offline"));
  render(<MembersBoard initialMembers={rows} initialLocationId="site" />);
  expect(within(screen.getByRole("region", { name: "Member results" })).getByText((_, node) => node?.tagName === "SPAN" && node.textContent === "2 matching")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "Person 0" } });
  expect(screen.queryByText((_, node) => node?.tagName === "SPAN" && node.textContent === "2 matching")).toBeNull();
  finish([rows[0]!]);
  await waitFor(() => expect(screen.getByText((_, node) => node?.tagName === "SPAN" && node.textContent === "1 matching")).toBeTruthy());
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ locationId: "site", search: "Person 0" }));
  fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "failed" } });
  await screen.findByRole("alert");
  expect(screen.queryByText((_, node) => node?.tagName === "SPAN" && node.textContent === "1 matching")).toBeNull();
});
