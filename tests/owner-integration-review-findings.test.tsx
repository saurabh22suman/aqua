// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const m=vi.hoisted(()=>({permissions:new Set<string>(),add:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:m.refresh,push:vi.fn()})}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({permissions:m.permissions}),requirePagePermission:(_ctx:unknown,p:string)=>{if(!m.permissions.has(p))throw Error("denied");}}));
vi.mock("@/lib/auth/context",()=>({requireDefaultCtx:async()=>({permissions:m.permissions})}));
vi.mock("@/lib/actions/programs",()=>({listBatchesAction:async()=>[],listCoachesAction:async()=>[],listProgramsAction:async()=>[]}));
vi.mock("@/lib/actions/people",()=>({listLocationsAction:async()=>[],listMembersAction:async()=>[]}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
vi.mock("@/lib/actions/tenant-timezone",()=>({getTenantTimezoneAction:async()=>"Asia/Kolkata"}));
vi.mock("@/lib/services/coach-schedule",()=>({listUpcomingSessions:async()=>[]}));
vi.mock("@/lib/services/programs",()=>({listBatches:async()=>[],listCoaches:async()=>[]}));
vi.mock("@/components/programs-batches-board",()=>({ProgramsBatchesBoard:()=>null}));
vi.mock("@/components/upcoming-sessions-list",()=>({UpcomingSessionsList:()=>null}));
vi.mock("@/lib/actions/enquiries",()=>({addFollowUpAction:m.add,bookTrialAction:vi.fn(),completeFollowUpAction:vi.fn(),convertEnquiryAction:vi.fn(),transitionEnquiryStageAction:vi.fn()}));
vi.mock("@/lib/actions/bookings",()=>({createBookingAction:vi.fn(),quoteBookingAction:vi.fn()}));
import ProgramsPage from "@/app/(owner)/owner/programs/page";
import SessionsPage from "@/app/(owner)/owner/sessions/page";
import {EnquiryDetailView} from "@/components/enquiry-detail-view";
import {OwnerScheduleGrid} from "@/components/owner-schedule-grid";
import {BookingForm} from "@/components/booking-form";
beforeEach(()=>{m.add.mockResolvedValue({ok:true});m.permissions=new Set();});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllEnvs();});
it("Programs hides destination links whose existing permission is absent",async()=>{
 m.permissions=new Set(["programs.read"]);render(await ProgramsPage({}));
 expect(screen.queryByTestId("link-schedule")).toBeNull();expect(screen.queryByTestId("link-sessions")).toBeNull();
});
it("Programs retains both destinations for the fully granted owner",async()=>{
 m.permissions=new Set(["programs.read","programs.write","attendance.read"]);render(await ProgramsPage({}));
 expect(screen.getByTestId("link-schedule").getAttribute("href")).toBe("/owner/schedule");expect(screen.getByTestId("link-sessions").getAttribute("href")).toBe("/owner/sessions");
});
it("Sessions hides Schedule when attendance permission is absent",async()=>{
 m.permissions=new Set(["programs.write","programs.read"]);render(await SessionsPage());expect(screen.queryByRole("link",{name:/Schedule grid/})).toBeNull();
});
it("Schedule does not expose Programs management with no Programs grant",()=>{
 render(<OwnerScheduleGrid view="week" locations={[]} sessions={[]} days={["2026-10-28"]} monthCells={null} prevHref="/owner/schedule" nextHref="/owner/schedule" todayHref="/owner/schedule" />);
 expect(screen.queryByRole("link",{name:"Manage batches"})).toBeNull();expect(screen.queryByRole("link",{name:"Add a session (via a batch)"})).toBeNull();
});
it("follow-up wall time is IST even on a UTC device",async()=>{
 vi.stubEnv("TZ","UTC");
 render(<EnquiryDetailView enquiry={{id:"e1",fullName:"Synthetic Enquiry",phone:"+919812340011",source:"online",stage:"contacted",memberId:null,locationId:"loc-1",createdAt:new Date(),followUps:[]} as never} locations={[]} batches={[]} terminology={{locale:"en",overrides:{}}}/>);
 fireEvent.change(screen.getByLabelText(/Due date and time/),{target:{value:"2026-10-28T15:30"}});fireEvent.click(screen.getByRole("button",{name:"Add follow-up"}));
 await waitFor(()=>expect(m.add).toHaveBeenCalledWith(expect.objectContaining({dueAt:"2026-10-28T10:00:00.000Z"})));
});
it("booking recipient choices have their visible group name",()=>{
 render(<BookingForm facilities={[]} timezone="Asia/Kolkata" today="2026-10-28" terminology={{locale:"en",overrides:{}}} facilityId="" onFacilityChange={vi.fn()} date="2026-10-28" onDateChange={vi.fn()} onCreated={vi.fn()}/>);
 expect(screen.getByRole("group",{name:"Who is it for?"})).toBeTruthy();
});
