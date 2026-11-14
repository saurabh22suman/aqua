// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const grid = vi.fn(async (input: unknown) => { void input; return []; });
const renderGrid = vi.fn((props: unknown) => { void props; return null; });
const SITE = "11111111-1111-4111-8111-111111111111";
vi.mock("next/headers", () => ({cookies:async () => ({get:() => ({value:SITE})})}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({permissions:new Set()}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/actions/tenant-timezone", () => ({getTenantTimezoneAction:async () => "Asia/Kolkata"}));
vi.mock("@/lib/actions/people", () => ({listLocationsAction:async () => []}));
vi.mock("@/lib/actions/schedule-grid", () => ({getScheduleGridAction:(arg:unknown) => grid(arg)}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction:async () => ({overrides:{},locale:"en"})}));
vi.mock("@/lib/services/coach-schedule", () => ({listUpcomingSessions:async () => []}));
vi.mock("@/components/owner-schedule-grid", () => ({OwnerScheduleGrid:(props:unknown) => renderGrid(props)}));
import OwnerSchedulePage from "@/app/(owner)/owner/schedule/page";
it("retains the selected facility when calendar is opened from navigation", async () => {
  await OwnerSchedulePage({searchParams:Promise.resolve({})});
  expect(grid).toHaveBeenCalledWith(expect.objectContaining({locationId:SITE}));
});
it("keeps an explicit all-locations selection while navigating dates", async () => {
  const { render } = await import("@testing-library/react");
  grid.mockClear(); renderGrid.mockClear();
  render(await OwnerSchedulePage({searchParams:Promise.resolve({location:"",date:"2026-11-13"})}));
  expect(grid).toHaveBeenCalledWith(expect.not.objectContaining({locationId:SITE}));
  expect(renderGrid.mock.calls[0]?.[0]).toEqual(expect.objectContaining({nextHref:expect.stringContaining("location=")}));
});
