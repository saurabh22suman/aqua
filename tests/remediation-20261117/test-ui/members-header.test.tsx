// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>({tenantId:"t",userId:"u"}),requirePagePermission:()=>{}}));
vi.mock("@/lib/auth/permission",()=>({hasPermission:()=>true}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("@/lib/actions/people",()=>({listMembersAction:async()=>[]}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({locale:"en",overrides:{}})}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),usePathname:()=>"/owner/members",useSearchParams:()=>new URLSearchParams()}));
import Page from "@/app/(owner)/owner/members/page";
afterEach(cleanup);
it("retains an accessible heading and scoped action in a mobile-stacked header",async()=>{
  const page=await Page({searchParams:Promise.resolve({facility:"all"})});
  const child=page.props.children as ReactElement<Record<string,unknown>,(props:Record<string,unknown>)=>Promise<ReactElement>>;
  render(await child.type(child.props));
  const heading=screen.getByRole("heading",{name:"Members"});
  const header=heading.parentElement?.parentElement;
  expect(header?.className).toContain("flex-col");
  expect(header?.className).toContain("sm:flex-row");
  expect(screen.getByRole("link",{name:"Add member"}).getAttribute("href")).toBe("/owner/members/new?facility=all");
  expect(screen.getByRole("link",{name:"Import"})).toBeTruthy();
});
