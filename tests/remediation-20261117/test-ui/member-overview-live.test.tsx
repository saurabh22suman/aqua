// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { fixture } from "@/tests/remediation-20261112/fixture";
const state=vi.hoisted(()=>({ctx:null as Ctx|null,forbidden:vi.fn()}));
vi.mock("@/lib/auth/context",()=>({ NotFoundError: class NotFoundError extends Error {},requireDefaultCtx:async()=>state.ctx}));
vi.mock("@/lib/auth/surface-guard",()=>({requireOwner:async()=>state.ctx}));
vi.mock("next/navigation",()=>({usePathname:()=>"/owner/members",useRouter:()=>({refresh:vi.fn()}),notFound:()=>{throw new Error("not found");}}));
vi.mock("@/lib/actions/attendance",()=>({getMemberAttendanceHistoryAction:state.forbidden}));
vi.mock("@/lib/actions/invoices",()=>({listMemberInvoicesAction:state.forbidden}));
vi.mock("@/lib/actions/makeup",()=>({listMakeupCreditsAction:state.forbidden,listMakeupSourcesAction:state.forbidden,listMakeupTargetsAction:state.forbidden}));
vi.mock("@/lib/actions/programs",()=>({listBatchesAction:state.forbidden}));
import Page from "@/app/(owner)/owner/members/[memberId]/page";
import { getMemberProgressAction } from "@/lib/actions/assessments";
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key<>'members.read'",[f.tenantId,f.managerMembership]);state.ctx={...f.context(f.managerId,"manager"),permissions:new Set(["members.read"])};});
afterAll(async()=>{if(f)await f.cleanup();});
it("preserves the full-profile refusal for a real members.read-only role",async()=>{
  await expect(Page({params:Promise.resolve({memberId:f.memberId})})).rejects.toThrow("not found");
  expect(state.forbidden).not.toHaveBeenCalled();
});
it("renders the authorized writer without attendance or program reads",async()=>{
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'members.write' from tenant_memberships where id=$2",[f.tenantId,f.managerMembership]);
  state.ctx={...f.context(f.managerId,"manager"),permissions:new Set(["members.read","members.write"])};
  expect(await Page({params:Promise.resolve({memberId:f.memberId})})).toBeTruthy();
  expect(state.forbidden).not.toHaveBeenCalled();
});
it("keeps direct Fees and Progress action reads forbidden for the same writer",async()=>{
  expect(await Page({params:Promise.resolve({memberId:f.memberId}),searchParams:Promise.resolve({tab:"payments"})})).toBeTruthy();
  expect(await Page({params:Promise.resolve({memberId:f.memberId}),searchParams:Promise.resolve({tab:"progress"})})).toBeTruthy();
  await expect(getMemberProgressAction(f.memberId)).rejects.toThrow();
  expect(state.forbidden).not.toHaveBeenCalled();
});
