// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
const state = vi.hoisted(() => ({ grid: vi.fn(), props: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({tenantId:"tenant", permissions:new Set(["attendance.read"])}), requirePagePermission: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({get: () => undefined}) }));
vi.mock("@/lib/services/selected-facility-access", () => ({canSelectFacility: async () => true}));
vi.mock("@/lib/services/people", () => ({listLocations: async () => []}));
vi.mock("@/db/tenant", () => ({withTenant: async () => [{timezone:"Asia/Kolkata"}]}));
vi.mock("@/lib/actions/schedule-grid", () => ({getScheduleGridAction: state.grid.mockResolvedValue([])}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction: async () => ({locale:"en",overrides:{}})}));
vi.mock("@/lib/services/coach-schedule", () => ({listUpcomingSessions: async () => []}));
vi.mock("@/components/owner-schedule-grid", () => ({OwnerScheduleGrid: (props: unknown) => {state.props(props); return null;}}));
import Page from "@/app/(owner)/owner/schedule/page";

it.each(["day", "week"])("retains the week chooser and scoped %s navigation", async (view) => {
  const facility = "11111111-1111-4111-8111-111111111111";
  render(await Page({searchParams: Promise.resolve({view,date:"2026-11-18",facility})}));
  const props = state.props.mock.calls.at(-1)?.[0];
  expect(props.chooserDays).toEqual(["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-21","2026-11-22"]);
  expect(props.dayHrefs["2026-11-19"]).toContain(`view=${view}&date=2026-11-19&facility=${facility}`);
  expect(props.prevHref).toContain(`facility=${facility}`);
  expect(state.grid).toHaveBeenLastCalledWith(expect.objectContaining({locationId: facility}));
  cleanup();
});
