// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
afterEach(cleanup);
it("does not describe an ordinary scheduled session as an exception", () => {
  render(<UpcomingSessionsList canManage coaches={[]} terminology={{locale:"en",overrides:{}}} initialSessions={[{id:"s",sessionDate:"2026-11-01",startsAt:new Date("2026-11-01T05:00:00Z"),endsAt:new Date("2026-11-01T06:00:00Z"),batchId:"b",batchName:"Morning",coachId:null,coachName:null,status:"scheduled"}]} />);
  expect(screen.getByRole("heading", {name:"Upcoming sessions"})).toBeTruthy();
  expect(screen.queryByText("Sessions needing management")).toBeNull();
});
