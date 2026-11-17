import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,beforeEach,describe,expect,it,vi } from "vitest";
import { fixture } from "./fixture";
const m=vi.hoisted(()=>({headers:new Headers(),store:{set:vi.fn(),delete:vi.fn()}}));
vi.mock("next/headers",()=>({headers:async()=>m.headers,cookies:async()=>m.store}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`);}}));
import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { selectClubAction } from "@/lib/actions/club-selection";
import { ensureBaUserForPhone,setCredential,pinLogin } from "@/lib/services/credentials";
import { listClubChoices } from "@/db/club-selection";
import { requireDefaultCtx } from "@/lib/auth/context";
import { ACTIVE_CLUB_COOKIE,ClubSelectionRequired } from "@/lib/auth/active-club";
let f:Awaited<ReturnType<typeof fixture>>,baId:string,sessionCookie:string,secondMembership:string;
beforeAll(async()=>{
 f=await fixture();const {rows:[user]}=await f.admin.query("select phone from users where id=$1",[f.userId]);baId=await ensureBaUserForPhone(user.phone);await setCredential(baId,"123456");const signed=await pinLogin(user.phone,"123456");sessionCookie=signed.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
 const role=randomUUID();secondMembership=randomUUID();await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'coach','Coach','/coach',2)",[role,f.otherTenant]);await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',false)",[secondMembership,f.otherTenant,f.userId,role]);
});afterAll(async()=>{await f?.cleanup();});beforeEach(()=>{vi.clearAllMocks();m.headers=new Headers({cookie:sessionCookie});});
describe("club selection authorizes against the authenticated live identity",()=>{
 it("requires a choice in request contexts before any data reads",async()=>{await expect(requireDefaultCtx()).rejects.toBeInstanceOf(ClubSelectionRequired);});
 it("lists only the signed-in user's operational memberships",async()=>{const choices=await listClubChoices(baId,new Date());expect(choices.map(c=>c.tenantId).sort()).toEqual([f.tenantId,f.otherTenant].sort());expect(await listClubChoices(randomUUID(),new Date())).toEqual([]);});
 it("sets a secure-scoped selection and clears old facility state",async()=>{await expect(selectClubAction({tenantId:f.otherTenant})).resolves.toEqual({kind:"ok",path:"/coach"});expect(m.store.set).toHaveBeenCalledWith(ACTIVE_CLUB_COOKIE,f.otherTenant,expect.objectContaining({httpOnly:true,sameSite:"lax",path:"/"}));expect(m.store.delete).toHaveBeenCalledWith("aqua_facility");});
 it("rebuilds the selected context with its own role and facilities",async()=>{m.headers.set("cookie",`${sessionCookie}; ${ACTIVE_CLUB_COOKIE}=${f.otherTenant}`);const ctx=await requireDefaultCtx();expect(ctx).toMatchObject({tenantId:f.otherTenant,roleKey:"coach",allLocations:false,locationIds:[]});expect(ctx.permissions.has("settings.manage")).toBe(false);});
 it("does not interpret a malformed selection cookie as a default",async()=>{m.headers.set("cookie",`${sessionCookie}; ${ACTIVE_CLUB_COOKIE}=invalid`);await expect(requireDefaultCtx()).rejects.toBeInstanceOf(ClubSelectionRequired);});
 it("refuses forged selection without setting any cookie",async()=>{expect(await selectClubAction({tenantId:randomUUID()})).toHaveProperty("error");expect(m.store.set).not.toHaveBeenCalled();});
 it("refuses missing identity",async()=>{m.headers=new Headers();expect(await selectClubAction({tenantId:f.tenantId})).toHaveProperty("error");expect(m.store.set).not.toHaveBeenCalled();});
 it("revokes both selection writes and stale-cookie contexts",async()=>{await f.admin.query("update tenant_memberships set status='revoked' where id=$1",[secondMembership]);expect(await selectClubAction({tenantId:f.otherTenant})).toHaveProperty("error");m.headers.set("cookie",`${sessionCookie}; ${ACTIVE_CLUB_COOKIE}=${f.otherTenant}`);await expect(requireDefaultCtx()).rejects.toBeInstanceOf(ClubSelectionRequired);expect(m.store.set).not.toHaveBeenCalled();});
 it("clears the active club at server-side sign-out",async()=>{await expect(logoutTenantAction()).rejects.toThrow("REDIRECT:/login");expect(m.store.delete).toHaveBeenCalledWith(ACTIVE_CLUB_COOKIE);});
});
