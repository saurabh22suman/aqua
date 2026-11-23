// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({cancel:vi.fn(),promote:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:state.refresh})}));
vi.mock("@/lib/actions/waitlist",()=>({cancelWaitlistAction:state.cancel,promoteHeadAction:state.promote}));
import { WaitlistBoard } from "@/components/waitlist-board";
const rows=[{entryId:"entry-a",memberId:"a",memberName:"Member A",memberCode:"A",position:1,requestedAt:new Date("2026-11-17")}];
beforeEach(()=>{vi.clearAllMocks();state.cancel.mockResolvedValue({kind:"ok",entryId:"entry-a",position:0});state.promote.mockResolvedValue({kind:"ok",entryId:"entry-a",position:1});});
afterEach(cleanup);
it("reviews without mutation, supports cancel and confirms only the selected member",async()=>{
  render(<WaitlistBoard batchId="b" batchName="Morning batch" initialRows={rows} canManage />);
  const review=screen.getByRole("button",{name:/review removal of member a/i});
  review.focus();fireEvent.click(review);
  expect(state.cancel).not.toHaveBeenCalled();
  const dialog=await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Member A/).textContent).toContain("Morning batch");
  expect(state.cancel).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:"Keep waiting"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.cancel).not.toHaveBeenCalled();
  fireEvent.click(review);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button",{name:"Remove from waitlist"}));
  await waitFor(()=>expect(state.cancel).toHaveBeenCalledWith({memberId:"a",batchId:"b"}));
  await waitFor(()=>expect(state.refresh).toHaveBeenCalledOnce());
});
it("keeps the review open and does not refresh on refusal",async()=>{
  state.cancel.mockResolvedValue({kind:"error",message:"Could not remove member."});
  render(<WaitlistBoard batchId="b" batchName="Morning batch" initialRows={rows} canManage />);
  fireEvent.click(screen.getByRole("button",{name:/review removal of member a/i}));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button",{name:"Remove from waitlist"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not remove member.");
  expect(screen.getByRole("dialog")).toBeTruthy();expect(state.refresh).not.toHaveBeenCalled();
});
it("keeps controls from read-only users and explains that promotion is not enrolment",()=>{
  render(<WaitlistBoard batchId="b" batchName="Morning batch" initialRows={rows} canManage={false} />);
  expect(screen.queryByRole("button",{name:/review removal/i})).toBeNull();
  expect(screen.queryByRole("button",{name:"Promote next"})).toBeNull();
  expect(screen.getByText(/promotion does not enrol/i)).toBeTruthy();
});
it("dismisses on the dialog cancel event and restores focus on close",async()=>{
  render(<WaitlistBoard batchId="b" batchName="Morning batch" initialRows={rows} canManage />);
  const review=screen.getByRole("button",{name:/review removal of member a/i});
  review.focus();fireEvent.click(review);
  const dialog=await screen.findByRole("dialog");
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  fireEvent(dialog, new Event("close", { bubbles: false }));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(review);
  expect(state.cancel).not.toHaveBeenCalled();
});
