// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({select:vi.fn(),sync:vi.fn(),clear:vi.fn(),navigate:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.navigate})}));
vi.mock("@/lib/actions/club-selection",()=>({selectClubAction:m.select}));
vi.mock("@/lib/offline/logout",()=>({syncBeforeLogout:m.sync}));
vi.mock("@/lib/offline/client-session",()=>({clearOfflineData:m.clear,runOfflineLifecycle:(fn:()=>Promise<unknown>)=>fn()}));
import { ClubChoice } from "@/components/club-choice";
const choice={tenantId:"11111111-1111-4111-8111-111111111111",name:"Club B",roleName:"Coach"};
beforeEach(()=>{vi.clearAllMocks();m.sync.mockResolvedValue(0);m.clear.mockResolvedValue(true);m.select.mockResolvedValue({kind:"ok",path:"/coach"});});afterEach(cleanup);
async function begin(){render(<ClubChoice choices={[choice]}/>);await waitFor(()=>expect((screen.getByRole("radio") as HTMLInputElement).disabled).toBe(false));fireEvent.click(screen.getByRole("radio"));fireEvent.click(screen.getByRole("button",{name:"Continue to club"}));}
describe("club switching preserves offline work",()=>{
 it("syncs then clears before changing the server selection",async()=>{await begin();await waitFor(()=>expect(m.select).toHaveBeenCalledWith({tenantId:choice.tenantId}));expect(m.sync.mock.invocationCallOrder[0]).toBeLessThan(m.clear.mock.invocationCallOrder[0]);expect(m.clear.mock.invocationCallOrder[0]).toBeLessThan(m.select.mock.invocationCallOrder[0]);await waitFor(()=>expect(m.navigate).toHaveBeenCalledWith("/coach"));expect(screen.queryByRole("alert")).toBeNull();});
 it("retains unsynced drafts until explicit discard",async()=>{m.sync.mockResolvedValue(2);await begin();await screen.findByText(/2 attendance marks/);expect(m.clear).not.toHaveBeenCalled();expect(m.select).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Discard drafts and switch"}));await waitFor(()=>expect(m.select).toHaveBeenCalledOnce());});
 it("can stay without changing club or deleting drafts",async()=>{m.sync.mockResolvedValue(2);await begin();fireEvent.click(await screen.findByRole("button",{name:"Stay in this club"}));expect(m.clear).not.toHaveBeenCalled();expect(m.select).not.toHaveBeenCalled();});
 it("does not switch when offline data cannot be cleared",async()=>{m.clear.mockResolvedValue(false);await begin();await screen.findByRole("alert");expect(m.select).not.toHaveBeenCalled();});
});
