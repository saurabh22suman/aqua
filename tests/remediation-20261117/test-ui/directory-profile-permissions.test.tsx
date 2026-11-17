// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const state=vi.hoisted(()=>({permissions:new Set<string>()}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({tenantId:"t",userId:"u",permissions:state.permissions}),requirePagePermission:()=>{}}));
vi.mock("@/lib/auth/permission",()=>({hasPermission:(_ctx:unknown,key:string)=>state.permissions.has(key)}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),usePathname:()=>"/owner/members",useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/lib/actions/people",()=>({listMembersAction:async()=>[{memberId:"m1",personId:"p1",fullName:"Roster Member",memberCode:"M1",locationId:"site",locationName:"North",status:"active",phone:null,isMinor:false,createdAt:"2026-01-01",joinedOn:"2026-01-01"}]}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
import Page from "@/app/(owner)/owner/members/page";
afterEach(cleanup);
async function show(){const page=await Page({searchParams:Promise.resolve({facility:"all"})});const child=page.props.children as ReactElement<Record<string,unknown>,(props:Record<string,unknown>)=>Promise<ReactElement>>;render(await child.type(child.props));}
it("shows roster-only identities without dead-end profile links",async()=>{
  state.permissions=new Set(["members.read"]);await show();
  expect(screen.getByText("Roster Member")).toBeTruthy();
  expect(screen.queryByRole("link",{name:/Roster Member/})).toBeNull();
  expect(screen.getByText(/directory-only access/i)).toBeTruthy();
});
it.each(["members.write","attendance.read","invoices.read"])("keeps the scoped profile destination with %s",async(grant)=>{
  state.permissions=new Set(["members.read",grant]);await show();
  expect(screen.getByRole("link",{name:/Roster Member/}).getAttribute("href")).toBe("/owner/members/m1?facility=all");
});
