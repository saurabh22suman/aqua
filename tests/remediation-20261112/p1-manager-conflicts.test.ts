import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixture } from "./fixture";
import type { Ctx } from "@/lib/auth/context";
import { detectCoachConflicts, detectSessionConflicts } from "@/lib/services/coach-conflicts";
import { randomUUID } from "node:crypto";
import { checkCoachConflictsAction } from "@/lib/actions/coach-conflicts";

let active: Ctx;
vi.mock("@/lib/auth/context", async importOriginal => ({...await importOriginal<typeof import("@/lib/auth/context")>(),requireDefaultCtx:()=>Promise.resolve(active)}));
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();active=f.context(f.managerId,"manager");});
afterAll(async()=>{await f?.cleanup();});
const slot=()=>({coachId:f.coachId,daysOfWeek:[1],startTime:"10:15",endTime:"10:45"});

describe("F01 conflict lookup honors live facility authority",()=>{
  it("direct manager service reads return only assigned-facility details",async()=>{
    const result=await detectCoachConflicts(f.context(f.managerId,"manager"),slot());
    expect(result.conflicts.map(b=>b.batchId)).toEqual([f.batchA]);
  });
  it("the real action preserves the manager context and permission boundary",async()=>{
    active=f.context(f.managerId,"manager");
    const result=await checkCoachConflictsAction(slot());
    expect(result.conflicts.map(b=>b.batchId)).toEqual([f.batchA]);
    active={...active,permissions:new Set()};
    await expect(checkCoachConflictsAction(slot())).rejects.toThrow("forbidden");
  });
  it("an owner retains both sites and whole-club conflicts",async()=>{
    const result=await detectCoachConflicts(f.context(),slot());
    expect(result.conflicts.map(b=>b.batchId).sort()).toEqual([f.batchA,f.batchB,f.batchUnlocated].sort());
  });
  it("a revoked membership grants nothing even with an old owner claim",async()=>{
    await f.admin.query("update tenant_memberships set status='revoked' where id=$1",[f.managerMembership]);
    try {
      expect((await detectCoachConflicts({...f.context(f.managerId,"manager"),roleKey:"owner",allLocations:true},slot())).conflicts).toEqual([]);
    } finally {await f.admin.query("update tenant_memberships set status='active' where id=$1",[f.managerMembership]);}
  });
  it("a different tenant cannot probe the coach's batch details",async()=>{
    expect((await detectCoachConflicts({...f.context(),tenantId:f.otherTenant},slot())).conflicts).toEqual([]);
  });
  it("session conflicts remain blocking without revealing another site's IDs",async()=>{
    const id=randomUUID();
    await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-12','2026-11-12T10:00Z','2026-11-12T11:00Z')",[id,f.tenantId,f.batchB,f.locationB,f.coachId]);
    const result=await detectSessionConflicts(f.context(f.managerId,"manager"),{coachId:f.coachId,sessionDate:"2026-11-12",startsAt:new Date("2026-11-12T10:15Z"),endsAt:new Date("2026-11-12T10:45Z")});
    expect(result).toMatchObject({hasConflicts:true,conflicts:[]});
  });
});
