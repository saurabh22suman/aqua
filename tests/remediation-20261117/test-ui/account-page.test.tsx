import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state=vi.hoisted(()=>({choices:[] as Array<{tenantId:string;name:string;roleName:string}>}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("next/navigation",()=>({redirect:()=>{throw new Error("redirect");},useRouter:()=>({push:vi.fn()})}));
vi.mock("@/lib/auth/server",()=>({auth:{api:{getSession:async()=>({user:{id:"user"},session:{createdAt:new Date()}})}}}));
vi.mock("@/db/scope",()=>({withPlatform:async(fn:()=>unknown)=>fn()}));
vi.mock("@/db/club-selection",()=>({listClubChoices:async()=>state.choices}));
vi.mock("@/lib/auth/active-club",()=>({activeClubFromHeaders:()=>"a"}));
vi.mock("@/components/tenant-sign-out",()=>({TenantSignOut:()=>null}));
import Page from "@/app/clubs/page";
it("explains the empty business account state",async()=>{
  state.choices=[];const html=renderToStaticMarkup(await Page({}));
  expect(html).toContain("Choose a business account");expect(html).toContain("No business accounts are available");
});
it("shows only returned account choices and their roles",async()=>{
  state.choices=[{tenantId:"a",name:"Allowed account",roleName:"Manager"}];const html=renderToStaticMarkup(await Page({}));
  expect(html).toContain("Allowed account");expect(html).toContain("Manager");expect(html).toContain("Current account");expect(html).not.toContain("No business accounts are available");
});
it("explains why the requested workspace could not be opened", async () => {
  state.choices = [{ tenantId: "a", name: "Allowed account", roleName: "Manager" }];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ unavailable: "1" }) }));
  expect(html).toContain('role="alert"');
  expect(html).toContain("That workspace is no longer available.");
  expect(html).toContain("Allowed account");
});
