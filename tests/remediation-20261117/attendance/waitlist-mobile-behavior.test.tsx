// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), promote: vi.fn(), cancel: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/waitlist", () => ({ promoteHeadAction: mocks.promote, cancelWaitlistAction: mocks.cancel }));
import { WaitlistBoard } from "@/components/waitlist-board";
const rows = [{ entryId: "entry-1", memberId: "member-1", memberName: "A long member identity for the waitlist", memberCode: "MEM-1", position: 1, requestedAt: new Date("2026-11-17T06:00:00Z") }];
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("keeps promotion bound to the queue head and names the removal target", async () => {
  mocks.promote.mockResolvedValue({ kind: "ok" });
  mocks.cancel.mockResolvedValue({ kind: "ok" });
  render(<WaitlistBoard batchId="batch-1" batchName="Morning batch" initialRows={rows} canManage />);
  fireEvent.click(screen.getByRole("button", { name: "Promote next" }));
  await waitFor(() => expect(mocks.promote).toHaveBeenCalledWith({ batchId: "batch-1", expectedEntryId: "entry-1" }));
  const opener = screen.getByRole("button", { name: `Review removal of ${rows[0]!.memberName}` });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByText(`Remove ${rows[0]!.memberName} from Morning batch's waitlist?`)).toBeTruthy();
  expect(mocks.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep waiting" }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Remove from waitlist" }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ memberId: "member-1", batchId: "batch-1" }));
});
it("does not offer management actions to a read-only viewer", () => {
  render(<WaitlistBoard batchId="batch-1" initialRows={rows} canManage={false} />);
  expect(screen.getByText(rows[0]!.memberName)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Promote next" })).toBeNull();
  expect(screen.queryByRole("button", { name: /review removal/i })).toBeNull();
});
