// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()}),usePathname:()=>"/owner/members",useSearchParams:()=>new URLSearchParams("facility=all")}));
vi.mock("@/lib/actions/tenant-auth",()=>({logoutTenantAction:vi.fn()}));
vi.mock("@/lib/actions/club-selection",()=>({selectClubAction:vi.fn()}));
import { TenantSignOut } from "@/components/tenant-sign-out";
import { ClubChoice } from "@/components/club-choice";
import { FacilitySwitcher } from "@/components/facility-switcher";
afterEach(cleanup);
it("labels /clubs as business-account switching",()=>{
  render(<TenantSignOut/>);
  expect(screen.getByRole("link",{name:"Switch business account"}).getAttribute("href")).toBe("/clubs");
  expect(screen.queryByRole("link",{name:"Switch club"})).toBeNull();
});
it("identifies available accounts, current account and role",()=>{
  render(<ClubChoice choices={[{tenantId:"a",name:"Synthetic",roleName:"Manager"}]} current="a"/>);
  expect(screen.getByText("Your available business accounts")).toBeTruthy();
  expect(screen.getByText(/Manager · Current account/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Continue to account"})).toBeTruthy();
});
it("keeps the scoped location picker as a club selector",()=>{
  render(<FacilitySwitcher locations={[{id:"a",name:"North"},{id:"b",name:"South"}]}/>);
  expect(screen.getByRole("combobox",{name:"Club"})).toBeTruthy();
  expect(screen.getByRole("option",{name:"All clubs"})).toBeTruthy();
});
