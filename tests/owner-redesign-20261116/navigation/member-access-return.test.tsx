import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn(async () => ({ memberId: "22222222-2222-4222-8222-222222222222", memberName: "Local member", memberCode: "LOCAL", facilityName: "Local facility", links: [] })));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner:async()=>({permissions:new Set()}),requirePagePermission:vi.fn() }));
vi.mock("@/lib/services/member-link-readmodel", () => ({readMemberAccessLinks:read}));
vi.mock("next/navigation", () => ({notFound:()=>{throw new Error("not found")}}));
vi.mock("@/components/member-detail/member-access-panel", () => ({MemberAccessPanel:()=>null}));
vi.mock("@/components/member-detail/member-enrollment-form", () => ({MemberEnrollmentForm:()=>null}));
import Page from "@/app/(owner)/owner/members/[memberId]/access/page";
const memberId="22222222-2222-4222-8222-222222222222";
afterEach(()=>read.mockClear());
it.each(["all","11111111-1111-4111-8111-111111111111"])("returns from member access with explicit %s scope",async(facility)=>{
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({memberId}),searchParams:Promise.resolve({facility})}));
  expect(html).toContain(`/owner/members/${memberId}?facility=${facility}`);
});
it("refuses malformed return scope before reading sign-in links",async()=>{
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({memberId}),searchParams:Promise.resolve({facility:"bad-scope"})}));
  expect(html).toContain("Facility unavailable");
  expect(read).not.toHaveBeenCalled();
});
