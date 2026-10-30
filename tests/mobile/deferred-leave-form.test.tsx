// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/actions/leave",()=>({requestLeaveAction:vi.fn(),cancelLeaveRequestAction:vi.fn()}));
import { MyLeaveCard } from "@/components/my-leave-card";
afterEach(cleanup);
describe("closed leave workflow does not initialise its form",()=>{
 it("loads on first opening and retains the mounted workflow after closing",async()=>{
 const {container}=render(<MyLeaveCard types={[]} balances={[]} requests={[]}/>);
 const details=container.querySelector("details")!;
 expect(details.textContent).not.toContain("No leave types are set up yet");
 details.open=true;fireEvent(details,new Event("toggle"));
 await waitFor(()=>expect(screen.getByText(/No leave types are set up yet/)).toBeTruthy());
 details.open=false;fireEvent(details,new Event("toggle"));
 expect(details.textContent).toContain("No leave types are set up yet");
 });
});
