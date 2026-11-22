// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({requireCoach:async () => ({})}));
const home = vi.hoisted(() => ({next:false}));
vi.mock("@/lib/actions/coach", () => ({getCoachHomeAction:async () => home.next ? ({sessions:[],next:{id:"s2",sessionDate:"2026-11-14",startsAt:"2026-11-14T04:30:00Z",endsAt:"2026-11-14T05:30:00Z",batchName:"Juniors",locationName:"North venue",marked:0,total:3}}) : ({sessions:[{id:"s1",startsAt:"2026-11-13T04:30:00Z",endsAt:"2026-11-13T05:30:00Z",batchName:"Juniors",locationName:"North venue",marked:0,total:3}],next:null}),getScheduleAction:async () => ({days:[{date:"2026-11-13",sessions:[{id:"s1",startsAt:"2026-11-13T04:30:00Z",batchName:"Juniors",locationName:"North venue",marked:0,total:3}]}]})}));
import CoachHomePage from "@/app/(coach)/coach/page";
import CoachSchedulePage from "@/app/(coach)/coach/schedule/page";
afterEach(() => {cleanup(); home.next = false;});
it("shows the session venue before opening the register", async () => {
  render(await CoachHomePage());
  expect(screen.getByTestId("coach-today-session").textContent).toContain("North venue");
});
it("shows the venue in the coach schedule task row", async () => {
  render(await CoachSchedulePage());
  expect(screen.getByTestId("coach-schedule-session").textContent).toContain("North venue");
});
it("shows the authorized venue on the next-session task too", async () => {
  home.next = true;
  render(await CoachHomePage());
  expect(screen.getByTestId("coach-up-next").textContent).toContain("North venue");
});
