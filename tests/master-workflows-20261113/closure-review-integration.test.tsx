// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { addDays, todayInZone } from "@/lib/time/tz";

let f: Awaited<ReturnType<typeof fixture>>;
const holidayId = randomUUID(), sessionId = randomUUID();
const date = addDays(todayInZone("Asia/Kolkata"), 10);
vi.mock("next/navigation", () => ({useRouter:() => ({refresh:vi.fn()})}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => f.context(),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/context", async (importOriginal) => ({...(await importOriginal<typeof import("@/lib/auth/context")>()),requireDefaultCtx:async () => f.context()}));
vi.mock("@/lib/auth/permission", () => ({requirePermission:vi.fn(),hasPermission:() => true}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({requireLiveOwnerSettingsPage:vi.fn()}));
vi.mock("@/lib/actions/holidays", () => ({listHolidaysAction:async () => [{id:holidayId,name:"Synthetic closure",holidayDate:date,recurringYearly:false}],addHolidayAction:vi.fn(),removeHolidayAction:vi.fn()}));
import HolidaysPage from "@/app/(owner)/owner/settings/holidays/page";
import { reviewClosure } from "@/lib/services/closure-review";
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into tenant_holidays(id,tenant_id,name,holiday_date,recurring_yearly) values($1,$2,'Synthetic closure',$3,false)",[holidayId,f.tenantId,date]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",[sessionId,f.tenantId,f.batchA,f.locationA,date,`${date}T04:30:00Z`,`${date}T05:30:00Z`]);
});
it("rechecks the live owner and tenant for closure reads", async () => {
  expect(await reviewClosure(f.context(f.managerId,"manager"),holidayId)).toBeNull();
  expect(await reviewClosure({...f.context(),tenantId:f.otherTenant},holidayId)).toBeNull();
});
it("finds recurring closures across facilities without cancelling sessions", async () => {
  const recurring = randomUUID(), second = randomUUID();
  await f.admin.query("insert into tenant_holidays(id,tenant_id,name,holiday_date,recurring_yearly) values($1,$2,'Recurring',$3,true)",[recurring,f.tenantId,`2020-${date.slice(5)}`]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",[second,f.tenantId,f.batchB,f.locationB,date,`${date}T04:30:00Z`,`${date}T05:30:00Z`]);
  const result = await reviewClosure(f.context(),recurring);
  expect(result?.sessions.map(row => row.id)).toEqual(expect.arrayContaining([sessionId,second]));
  expect((await f.admin.query("select status from sessions where id=$1",[second])).rows[0].status).toBe("scheduled");
  await f.admin.query("delete from sessions where id=$1",[second]);
  await f.admin.query("delete from tenant_holidays where id=$1",[recurring]);
});
it("excludes held sessions and sessions with deleted batches or locations", async () => {
  try {
    await f.admin.query("update sessions set status='held' where id=$1",[sessionId]);
    expect((await reviewClosure(f.context(),holidayId))!.sessions.map(row => row.id)).not.toContain(sessionId);
    await f.admin.query("update sessions set status='scheduled' where id=$1",[sessionId]);
    await f.admin.query("update batches set deleted_at=now() where id=$1",[f.batchA]);
    expect((await reviewClosure(f.context(),holidayId))!.sessions.map(row => row.id)).not.toContain(sessionId);
    await f.admin.query("update batches set deleted_at=null where id=$1",[f.batchA]);
    await f.admin.query("update locations set deleted_at=now() where id=$1",[f.locationA]);
    expect((await reviewClosure(f.context(),holidayId))!.sessions.map(row => row.id)).not.toContain(sessionId);
  } finally {
    await f.admin.query("update sessions set status='scheduled' where id=$1",[sessionId]);
    await f.admin.query("update batches set deleted_at=null where id=$1",[f.batchA]);
    await f.admin.query("update locations set deleted_at=null where id=$1",[f.locationA]);
  }
});
it("reports an honest empty affected set", async () => {
  const emptyHoliday = randomUUID();
  await f.admin.query("insert into tenant_holidays(id,tenant_id,name,holiday_date,recurring_yearly) values($1,$2,'Empty',$3,false)",[emptyHoliday,f.tenantId,addDays(date,2)]);
  expect((await reviewClosure(f.context(),emptyHoliday))?.sessions).toEqual([]);
  await f.admin.query("delete from tenant_holidays where id=$1",[emptyHoliday]);
});
afterAll(async () => { cleanup(); if (f) {await f.admin.query("delete from tenant_holidays where tenant_id=$1",[f.tenantId]); await f.cleanup();} });
it("shows the affected future session without mutating it", async () => {
  render(await HolidaysPage());
  expect(screen.getByText(/1 affected session/i)).toBeTruthy();
  expect(screen.getByRole("link",{name:/review.*sessions/i})).toBeTruthy();
  const {rows} = await f.admin.query("select status from sessions where id=$1",[sessionId]);
  expect(rows[0].status).toBe("scheduled");
});
