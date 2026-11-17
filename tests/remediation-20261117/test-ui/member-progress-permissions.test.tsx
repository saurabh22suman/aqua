// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const id="11111111-1111-4111-8111-111111111111";
const state=vi.hoisted(()=>({allowed:false,progress:vi.fn(async()=>null)}));
vi.mock("next/navigation",()=>({usePathname:()=>"/owner/members",useRouter:()=>({refresh:vi.fn()}),notFound:()=>{throw new Error("not found");}}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({tenantId:"t",userId:"u"})}));
vi.mock("@/lib/auth/permission",()=>({hasFeature:()=>true,hasPermission:(_ctx:unknown,key:string)=>key==="attendance.read" || (key==="levels.read" && state.allowed)}));
vi.mock("@/lib/actions/people",()=>({getMemberDetailAction:async()=>({memberId:id,personId:"p",fullName:"Member",memberCode:"M",locationName:"Club",status:"active",joinedOn:"2026-01-01"}),getMemberIdCardContextAction:vi.fn(),listLocationsAction:vi.fn(),updateMemberAction:vi.fn(),transitionMemberStatusAction:vi.fn(),getMemberPayerAction:vi.fn()}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
vi.mock("@/lib/actions/tenant-timezone",()=>({getTenantTimezoneAction:async()=>"Asia/Kolkata"}));
vi.mock("@/lib/actions/assessments",()=>({getMemberProgressAction:state.progress}));
import Page from "@/app/(owner)/owner/members/[memberId]/page";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("does not offer or read Progress without levels.read",async()=>{
  state.allowed=false;render(await Page({params:Promise.resolve({memberId:id}),searchParams:Promise.resolve({tab:"progress"})}));
  expect(screen.queryByRole("link",{name:"Progress"})).toBeNull();
  expect(screen.getByText(/do not have access to progress/i)).toBeTruthy();
  expect(state.progress).not.toHaveBeenCalled();
});
it("offers and reads Progress when the feature and permission are granted",async()=>{
  state.allowed=true;render(await Page({params:Promise.resolve({memberId:id}),searchParams:Promise.resolve({tab:"progress"})}));
  expect(screen.getByRole("link",{name:"Progress"})).toBeTruthy();
  expect(state.progress).toHaveBeenCalledWith(id);
});
