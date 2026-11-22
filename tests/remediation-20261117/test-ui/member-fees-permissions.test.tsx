// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const id = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ allowed:false, invoices:vi.fn(), panel:vi.fn() }));
vi.mock("next/navigation", () => ({usePathname:()=>"/owner/members",useRouter:()=>({refresh:vi.fn()}),notFound:()=>{throw new Error("not found");}}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({tenantId:"t",userId:"u"})}));
vi.mock("@/lib/auth/permission",()=>({hasFeature:()=>false,hasPermission:(_ctx:unknown,key:string)=> key === "attendance.read" || (key === "invoices.read" && state.allowed)}));
vi.mock("@/lib/actions/people",()=>({getMemberDetailAction:async()=>({memberId:id,personId:"p",fullName:"Member",memberCode:"M",locationName:"Club",status:"active",joinedOn:"2026-01-01"}),getMemberIdCardContextAction:vi.fn(),listLocationsAction:vi.fn(),updateMemberAction:vi.fn(),transitionMemberStatusAction:vi.fn(),getMemberPayerAction:vi.fn()}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
vi.mock("@/lib/actions/tenant-timezone",()=>({getTenantTimezoneAction:async()=>"Asia/Kolkata"}));
vi.mock("@/lib/actions/invoices",()=>({listMemberInvoicesAction:state.invoices}));
vi.mock("@/components/member-detail/member-invoices-panel",()=>({MemberInvoicesPanel:()=>{state.panel();return <div>Invoices panel</div>;}}));
import Page from "@/app/(owner)/owner/members/[memberId]/page";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("denies direct Fees and hides its navigation when invoices.read is absent",async()=>{
  state.allowed=false;
  render(await Page({params:Promise.resolve({memberId:id}),searchParams:Promise.resolve({tab:"payments"})}));
  expect(screen.queryByRole("link",{name:"Fees"})).toBeNull();
  expect(screen.getByText(/access.*invoices|invoices.*access/i)).toBeTruthy();
  expect(state.invoices).not.toHaveBeenCalled();expect(state.panel).not.toHaveBeenCalled();
});
it("offers Fees and its panel with invoices.read",async()=>{
  state.allowed=true;
  render(await Page({params:Promise.resolve({memberId:id}),searchParams:Promise.resolve({tab:"payments"})}));
  expect(screen.getByRole("link",{name:"Fees"})).toBeTruthy();
  expect(screen.getByText("Invoices panel")).toBeTruthy();
});
