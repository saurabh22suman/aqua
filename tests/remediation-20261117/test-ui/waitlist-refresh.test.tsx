// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({refresh:vi.fn(),promote:vi.fn(async()=>({kind:"error" as const,code:"conflict",message:"The waitlist has changed."}))}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:state.refresh})}));
vi.mock("@/lib/actions/waitlist",()=>({promoteHeadAction:state.promote,cancelWaitlistAction:vi.fn()}));
import { WaitlistBoard } from "@/components/waitlist-board";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("offers a refresh after a stale head conflict without promoting another member",async()=>{
  render(<WaitlistBoard batchId="b" canManage initialRows={[{entryId:"entry-a",memberId:"a",memberName:"Member A",memberCode:"A",position:1,requestedAt:new Date()}]} />);
  fireEvent.click(screen.getByRole("button",{name:"Promote next"}));
  expect((await screen.findByRole("alert")).textContent).toContain("The waitlist has changed.");
  expect(state.promote).toHaveBeenCalledWith({batchId:"b",expectedEntryId:"entry-a"});
  fireEvent.click(screen.getByRole("button",{name:"Refresh list"}));
  expect(state.refresh).toHaveBeenCalledOnce();
});
