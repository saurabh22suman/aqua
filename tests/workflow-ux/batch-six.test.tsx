// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { MemberProgress } from "@/lib/services/skill-progress";
import { LoginForm } from "@/components/login-form";
import { MemberCreateForm } from "@/components/member-create-form";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { AssessmentBoard } from "@/components/assessment-board";
import BatchDetailPage from "@/app/(owner)/owner/batches/[batchId]/page";

const stubs = vi.hoisted(() => ({home: vi.fn(), push: vi.fn(), search: vi.fn(), record: vi.fn(), progress: vi.fn()}));
const guards = vi.hoisted(() => ({ location: "11111111-1111-4111-8111-111111111111" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: stubs.push }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/actions/auth-ui", () => ({ homeForSessionAction: stubs.home }));
vi.mock("@/lib/actions/people", () => ({ searchPersonsAction: stubs.search, createMemberAction: vi.fn() }));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: async () => [{ id: "batch", name: "Junior TTS", programName: "Swim", locationName: "North", startTime: "07:00:00", endTime: "08:00:00", coachName: "Coach Mina", capacity: 12 }],
  createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(),
}));
vi.mock("@/lib/actions/assessments", () => ({ recordAssessmentAction: stubs.record, getMemberProgressAction: stubs.progress }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ NotFoundError: class NotFoundError extends Error {}, requireDefaultCtx: async () => ({ tenantId: "club" }) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (_ctx: unknown, key: string) => key === "attendance.read", hasFeature: () => false }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => true }));
vi.mock("@/lib/services/attendance-history", () => ({
  currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-12-01" }),
  getBatchAttendanceSummary: async () => ({ pct: null, sessionCount: 1 }),
}));
vi.mock("@/lib/services/coach-schedule", () => ({
  listUpcomingSessions: async () => [{ id: "session", batchId: "batch", sessionDate: "2099-11-21", startsAt: new Date("2099-11-21T01:30:00Z"), endsAt: new Date("2099-11-21T02:30:00Z"), status: "scheduled", coachName: "Coach Mina", locationName: "North" }],
}));
vi.mock("@/lib/services/register", () => ({
  getRosterForSession: async () => ({ rows: [{ memberId: "m1", name: "Demo Learner", code: "L1" }] }),
}));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: vi.fn() }));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => null }));

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("resumes workspace loading after the PIN has been accepted without posting credentials again", async () => {
  const post = vi.fn().mockResolvedValue(new Response("{}", {status: 200}));
  vi.stubGlobal("fetch", post);
  stubs.home.mockRejectedValueOnce(new Error("disconnected")).mockResolvedValueOnce({kind: "ok", path: "/owner"});
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Mobile number"), {target:{value:"9000000001"}});
  fireEvent.change(screen.getByLabelText("PIN"), {target:{value:"123456"}});
  fireEvent.click(screen.getByRole("button",{name:"Sign in"}));
  const retry = await screen.findByRole("button",{name:"Open workspace"});
  expect(screen.getByLabelText<HTMLInputElement>("PIN").value).toBe("");
  await act(async () => { fireEvent.click(retry); });
  expect(stubs.push).toHaveBeenCalledWith("/owner");
  expect(post).toHaveBeenCalledTimes(1);
});

it("drops stale guardians when a newer query finishes and offers retry on a failed search", async () => {
  let stale!: (rows: object[]) => void;
  stubs.search.mockImplementationOnce(() => new Promise((resolve) => { stale=resolve; }))
    .mockResolvedValueOnce([{personId:"b",fullName:"Bina Das",phone:null}])
    .mockRejectedValueOnce(new Error("disconnected"));
  render(<MemberCreateForm locations={[{id:"north",name:"North"}]} terminology={{locale:"en",overrides:{}}} />);
  fireEvent.change(screen.getByTestId("member-dob"),{target:{value:"01/01/2015"}});
  const query=screen.getByTestId("guardian-search");
  fireEvent.change(query,{target:{value:"Al"}});
  fireEvent.change(query,{target:{value:"Bi"}});
  await screen.findByRole("button",{name:"Bina Das"});
  await act(async () => stale([{personId:"a",fullName:"Alka Das",phone:null}]));
  expect(screen.queryByRole("button",{name:"Alka Das"})).toBeNull();
  expect(screen.getByRole("button",{name:"Bina Das"})).toBeTruthy();
  await act(async () => fireEvent.change(query,{target:{value:"Ra"}}));
  expect(screen.getByRole("button",{name:"Retry guardian search"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Bina Das"})).toBeNull();
});

it("finds batches within the current catalogue by batch, coach or club and clears the filter", () => {
  const rows = [
    {id:"a", name:"Beginners", coachName:"Mina Rao", locationName:"North"},
    {id:"b", name:"Intermediate", coachName:"Vihaan Das", locationName:"South"},
  ].map(row=>({...row,programId:"p",programName:"Aquatics",daysOfWeek:[1],startTime:"07:00",endTime:"08:00",capacity:12} as BatchWithProgramName));
  render(<ProgramsBatchesBoard initialPrograms={[{id:"p",name:"Aquatics"} as Program]} initialBatches={rows} coaches={[]} locations={[]} terminology={{locale:"en",overrides:{}}} canManage={false} />);
  fireEvent.change(screen.getByRole("searchbox",{name:"Find a batch"}),{target:{value:"Mina"}});
  expect(screen.getByRole("link",{name:"View batch Beginners"})).toBeTruthy();
  expect(screen.queryByRole("link",{name:"View batch Intermediate"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Clear batch search"}));
  expect(screen.getByRole("link",{name:"View batch Intermediate"})).toBeTruthy();
});

it("shows the next session and its roster together with a club-scoped schedule link", async () => {
  render(await BatchDetailPage({
    params: Promise.resolve({batchId:"batch"}),
    searchParams: Promise.resolve({facility:guards.location}),
  }));
  const next=screen.getByRole("region",{name:"Next session"});
  expect(within(next).getByRole("heading",{name:"Next session roster"})).toBeTruthy();
  expect(within(next).getByText("Demo Learner")).toBeTruthy();
  const link=new URL(within(next).getByRole("link",{name:"Open schedule"}).getAttribute("href")!,"https://example.test");
  expect([link.searchParams.get("date"),link.searchParams.get("facility")]).toEqual(["2099-11-21",guards.location]);
});

it("checks the latest server band after an uncertain save and keeps the coach’s note", async () => {
  const progress:MemberProgress={memberId:"m",memberName:"Demo Learner",memberCode:"L1",frameworks:[{id:"f",name:"Swim",activityTypeKey:"swim",nodes:[{
    id:"s",parentId:null,name:"Float",ordinal:1,rubric:{},band:1,assessedAt:null,assessedByName:null,history:[],
  }]}]};
  stubs.record.mockRejectedValueOnce(new Error("disconnected"));
  stubs.progress.mockResolvedValueOnce(progress);
  render(<AssessmentBoard memberId="m" progress={progress} canAssess back={{href:"/coach",label:"Back"}} />);
  const note = screen.getByRole<HTMLInputElement>("textbox",{name:"Note for Float"});
  fireEvent.change(note,{target:{value:"Practised holding steady"}});
  const target=screen.getByRole<HTMLButtonElement>("button",{name:"Float band 2"});
  fireEvent.click(target);
  const check=await screen.findByRole("button",{name:"Check saved assessment"});
  expect(target.disabled).toBe(true);
  await act(async () => fireEvent.click(check));
  expect(screen.getByRole("button",{name:"Float band 1"}).getAttribute("aria-pressed")).toBe("true");
  expect(target.disabled).toBe(false);
  expect(note.value).toBe("Practised holding steady");
  expect(stubs.record).toHaveBeenCalledTimes(1);
});
