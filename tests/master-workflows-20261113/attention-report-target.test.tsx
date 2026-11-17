// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const capture = vi.fn((props: unknown) => { void props; return null; });
const ids = {a:"11111111-1111-4111-8111-111111111111",b:"22222222-2222-4222-8222-222222222222"};
const marks = {present:1,late:0,absent:0,total:1};
const register = {sessionsWithRoster:1,completedRegisters:1,completionPct:100,rosterSlots:1,markedSlots:1,unmarkedSlots:0};
const shares = {present:100,late:0,absent:0};
const row = (id:string) => ({batchId:id,batchName:id,programName:"Program",locationId:null,sessions:1,marks,shares,register});
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/permission", () => ({hasFeature:() => true}));
vi.mock("next/headers", () => ({cookies:async () => ({get:() => undefined})}));
vi.mock("@/lib/actions/owner-insights", () => ({getOwnerInsightsAttendanceAction:async () => ({from:"2026-11-13",to:"2026-11-14",summary:{sessions:2,marks:{present:2,late:0,absent:0,total:2},shares,register},rows:[row(ids.a),row(ids.b)]})}));
vi.mock("@/components/reports/owner-approved/attendance-results", () => ({AttendanceResults:(props:unknown) => capture(props)}));
vi.mock("@/components/reports/owner-approved/attendance-range", () => ({AttendanceRange:() => null}));
import AttendancePage from "@/app/(owner)/owner/reports/attendance/page";
it("renders only the targeted authorized batch's report and summary", async () => {
  const {render} = await import("@testing-library/react");
  render(await AttendancePage({searchParams:Promise.resolve({from:"2026-11-13",to:"2026-11-13",...{batch:ids.a}})}));
  expect(capture.mock.calls[0]?.[0]).toEqual(expect.objectContaining({data:expect.objectContaining({rows:[expect.objectContaining({batchId:ids.a})],summary:expect.objectContaining({sessions:1})})}));
});
it("opens a second batch as different evidence rather than reusing the first target", async () => {
  const {render, cleanup} = await import("@testing-library/react");
  capture.mockClear();
  render(await AttendancePage({searchParams:Promise.resolve({from:"2026-11-13",to:"2026-11-13",batch:ids.b})}));
  expect(capture.mock.calls[0]?.[0]).toEqual(expect.objectContaining({data:expect.objectContaining({rows:[expect.objectContaining({batchId:ids.b})],summary:expect.objectContaining({sessions:1})})}));
  cleanup();
});
it("does not widen the report when the targeted batch is unavailable or malformed", async () => {
  const {render, screen, cleanup} = await import("@testing-library/react");
  capture.mockClear();
  render(await AttendancePage({searchParams:Promise.resolve({from:"2026-11-13",to:"2026-11-13",...{batch:"33333333-3333-4333-8333-333333333333"}})}));
  expect(screen.getByText(/no attendance evidence.*selected scope/i)).toBeTruthy();
  expect(capture).not.toHaveBeenCalled();
  cleanup();
  render(await AttendancePage({searchParams:Promise.resolve({from:"2026-11-13",to:"2026-11-13",...{batch:"not-valid"}})}));
  expect(screen.getByRole("alert").textContent).toMatch(/invalid report scope/i);
  expect(capture).not.toHaveBeenCalled();
});
