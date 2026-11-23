// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permissions:new Set<string>(), features:new Set<string>(), summary:vi.fn(async () => ({batchName:"Batch A",pct:null,sessionCount:0})), upcoming:vi.fn(async () => []) }));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async()=>({}),requirePagePermission:()=>{}}));
vi.mock("@/lib/auth/context", () => ({ NotFoundError: class NotFoundError extends Error {},requireDefaultCtx:async()=>({tenantId:"tenant",permissions:state.permissions,features:state.features})}));
vi.mock("next/navigation", () => ({notFound:()=>{throw new Error("not found");}}));
vi.mock("@/db/tenant", () => ({withTenant:async()=>[{timezone:"Asia/Kolkata"}]}));
vi.mock("@/lib/services/attendance-history", () => ({currentMonthPeriod:()=>({from:"2026-11-01",to:"2026-11-30"}),getBatchAttendanceSummary:state.summary}));
vi.mock("@/lib/services/coach-schedule", () => ({listUpcomingSessions:state.upcoming}));
vi.mock("@/lib/actions/programs", () => ({listBatchesAction:async()=>[{id:"batch",name:"Batch A",programName:"Swim",locationName:"Club",startTime:"07:00:00",endTime:"08:00:00",coachName:"Coach Lee",capacity:12}]}));
vi.mock("@/lib/actions/waitlist", () => ({listWaitlistAction:async()=>[]}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction:async()=>({overrides:{},locale:"en"})}));
import Page from "@/app/(owner)/owner/batches/[batchId]/page";

it("does not read or render attendance for a programs-only viewer", async () => {
  state.permissions = new Set(["programs.read"]); state.summary.mockClear(); state.upcoming.mockClear();
  const html = renderToStaticMarkup(await Page({params:Promise.resolve({batchId:"batch"})}));
  expect(html).toContain("Batch A");
  expect(html).not.toContain("batch-attendance");
  expect(state.summary).not.toHaveBeenCalled();
  expect(state.upcoming).not.toHaveBeenCalled();
});
it("reads and renders attendance when granted", async () => {
  state.permissions = new Set(["programs.read","attendance.read"]); state.summary.mockClear();
  const html = renderToStaticMarkup(await Page({params:Promise.resolve({batchId:"batch"})}));
  expect(html).toContain("batch-attendance");
  expect(state.summary).toHaveBeenCalledOnce();
});

it("offers the independently authorized report without reading attendance on this page", async () => {
  state.permissions = new Set(["programs.read", "reports.operational"]); state.features = new Set(["reports"]);
  state.summary.mockClear(); state.upcoming.mockClear();
  const html = renderToStaticMarkup(await Page({params:Promise.resolve({batchId:"batch"}),searchParams:Promise.resolve({facility:"all"})}));
  expect(html).toContain("Open attendance report");
  expect(html).toContain("facility=all");
  expect(html).not.toContain("batch-attendance");
  expect(state.summary).not.toHaveBeenCalled();
  expect(state.upcoming).not.toHaveBeenCalled();
});
