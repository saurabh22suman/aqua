// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const id="11111111-1111-4111-8111-111111111111";
const state=vi.hoisted(()=>({permissions:new Set<string>(),attendance:vi.fn(async()=>({rows:[],today:"2026-11-17"})), invoices:vi.fn(async()=>[]), batches:vi.fn(async()=>[]), makeup:vi.fn(async()=>[]), enrolments:vi.fn(async()=>[]), plans:vi.fn(async()=>[]), subscriptions:vi.fn(async()=>[])}));
vi.mock("next/navigation",()=>({usePathname:()=>"/owner/members",useRouter:()=>({refresh:vi.fn()}),notFound:()=>{throw new Error("not found");}}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({tenantId:"t",userId:"u",permissions:state.permissions})}));
vi.mock("@/lib/auth/permission",()=>({hasFeature:()=>false,hasPermission:(_ctx:unknown,key:string)=>state.permissions.has(key)}));
vi.mock("@/lib/actions/people",()=>({getMemberDetailAction:async()=>({memberId:id,personId:"p",fullName:"Member",memberCode:"M",locationId:"site",locationName:"Club",status:"active",joinedOn:"2026-01-01",isMinor:false,guardians:[],consents:[],statusHistory:[],phone:null,gender:null,dateOfBirth:null,medicalNotes:null}),getMemberIdCardContextAction:async()=>null,listLocationsAction:async()=>[],updateMemberAction:vi.fn(),transitionMemberStatusAction:vi.fn(),getMemberPayerAction:vi.fn()}));
vi.mock("@/lib/actions/attendance",()=>({getMemberAttendanceHistoryAction:state.attendance}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
vi.mock("@/lib/actions/tenant-timezone",()=>({getTenantTimezoneAction:async()=>"Asia/Kolkata"}));
vi.mock("@/lib/actions/facility-optins",()=>({listOptedFacilitiesAction:async()=>[]}));
vi.mock("@/lib/actions/invoices",()=>({listMemberInvoicesAction:state.invoices}));
vi.mock("@/lib/actions/enrolment",()=>({listMemberEnrolmentsAction:state.enrolments,enrolMemberAction:vi.fn()}));
vi.mock("@/lib/actions/programs",()=>({listBatchesAction:state.batches}));
vi.mock("@/lib/actions/subscriptions",()=>({listMemberSubscriptionsAction:state.subscriptions,listMemberSubscriptionPlansAction:state.plans}));
vi.mock("@/lib/actions/makeup",()=>({listMakeupCreditsAction:state.makeup,listMakeupSourcesAction:state.makeup,listMakeupTargetsAction:state.makeup}));
import Page from "@/app/(owner)/owner/members/[memberId]/page";
it("composes a members-only overview without attendance, invoices, makeup or batch-editor reads",async()=>{
  state.permissions=new Set(["members.read"]);vi.clearAllMocks();
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({memberId:id})}));
  expect(html).toContain("Personal details");expect(html).toContain("Membership plan");expect(html).toContain("Batches");
  expect(html).not.toContain("Attendance");expect(html).not.toContain("Retry");
  expect(state.attendance).not.toHaveBeenCalled();expect(state.invoices).not.toHaveBeenCalled();expect(state.makeup).not.toHaveBeenCalled();expect(state.batches).not.toHaveBeenCalled();
  expect(state.enrolments).toHaveBeenCalledOnce();expect(state.subscriptions).toHaveBeenCalledOnce();
});
it("reads program choices and attendance only when separately granted",async()=>{
  state.permissions=new Set(["members.read","programs.read","attendance.read"]);vi.clearAllMocks();
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({memberId:id})}));
  expect(html).toContain("Attendance");expect(state.attendance).toHaveBeenCalledOnce();expect(state.makeup).toHaveBeenCalledTimes(3);expect(state.batches).toHaveBeenCalledOnce();expect(state.invoices).not.toHaveBeenCalled();
});
