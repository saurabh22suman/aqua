// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const join = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/waitlist", () => ({ addToWaitlistAction: join }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: vi.fn(async () => [
  { id: "a", name: "Batch A", capacity: 10, programName: "Swim", coachName: null, locationName: "Club", daysOfWeek: [], startTime: "07:00:00", endTime: "08:00:00" },
  { id: "b", name: "Batch B", capacity: 10, programName: "Swim", coachName: null, locationName: "Club", daysOfWeek: [], startTime: "07:00:00", endTime: "08:00:00" },
] ) }));
vi.mock("@/lib/actions/enrolment", () => ({ listMemberEnrolmentsAction: vi.fn(async () => []), enrolMemberAction: vi.fn(async () => ({ ok: false, error: "This batch is full." })) }));
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("withdraws the full batch offer when another batch is selected", async () => {
  render(<MemberEnrolmentPanel memberId="m1" terminology={{ overrides: {}, locale: "en" }} canEnrol canWaitlist />);
  fireEvent.click(await screen.findByRole("button", { name: /^enrol$/i }));
  expect(await screen.findByRole("button", { name: /join waitlist/i })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  await waitFor(() => expect(screen.queryByRole("button", { name: /join waitlist/i })).toBeNull());
  expect(screen.queryByText("This batch is full.")).toBeNull();
  expect(join).not.toHaveBeenCalled();
});
