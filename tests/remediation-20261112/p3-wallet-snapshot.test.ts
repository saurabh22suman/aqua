import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { fixture } from "./fixture";
import { holdFirstRead } from "./query-gate";
import { balanceOf,topUp } from "@/lib/services/wallet";
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();});afterAll(async()=>{await f?.cleanup();});
const deposit=()=>topUp(f.context(),{memberId:f.memberId,locationId:f.locationA,amountPaise:100,method:"cash",idempotencyKey:randomUUID()});
describe("F12 wallet balance reads one consistent ledger",()=>{
  it("does not report corruption while a legitimate top-up commits",async()=>{
    expect((await deposit()).ok).toBe(true);const gate=holdFirstRead(/select .*sum.* from "account_entries"/i, /select .* from "members"/i);
    try {const balance=balanceOf(f.context(),f.memberId).then(value=>({value}),error=>({error}));await gate.reached;const adding=deposit();await gate.waitForCompetition(f.admin,adding);gate.release();expect(await balance).toEqual({value:100});expect((await adding).ok).toBe(true);expect(await balanceOf(f.context(),f.memberId)).toBe(200);}
    finally {gate.close();}
  },10000);
  it("still refuses another tenant's wallet",async()=>{await expect(balanceOf({...f.context(),tenantId:f.otherTenant},f.memberId)).rejects.toThrow("Member not found");});
});
