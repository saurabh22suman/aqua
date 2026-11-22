// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BatchWithProgramName } from "@/lib/services/programs";
const actions = vi.hoisted(() => ({ batches: vi.fn(), enrolments: vi.fn(), enrol: vi.fn(), transfer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: actions.batches }));
vi.mock("@/lib/actions/enrolment", () => ({ listMemberEnrolmentsAction: actions.enrolments, enrolMemberAction: actions.enrol }));
vi.mock("@/lib/actions/transfer", () => ({ transferMemberToBatchAction: actions.transfer }));
vi.mock("@/lib/actions/waitlist", () => ({ addToWaitlistAction: vi.fn() }));
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
const batches = [
  { id: "home", name: "Morning", programName: "Swimming", locationId: "a", locationName: "North" },
  { id: "other", name: "Morning", programName: "Swimming", locationId: "b", locationName: "South" },
  { id: "denied", name: "Morning", programName: "Swimming", locationId: "c", locationName: "Denied" },
  { id: "wide", name: "Open", programName: "Swimming", locationId: null, locationName: null },
] as BatchWithProgramName[];
const enrolments = [{ batchId: "existing", batchName: "Existing", programName: "Swim", enrolledOn: "2026-01-01" }];
const facility = { homeId: "a", eligible: [{ id: "a", name: "North" }, { id: "b", name: "South" }] };
const terminology = { overrides: {}, locale: "en" as const };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("defaults to home, retains existing enrolments, and requires an explicit site choice", () => {
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", enrolments, batches }} />);
  expect(screen.getByText(/Existing/)).toBeTruthy();
  const site = screen.getByLabelText("Enrolment facility") as HTMLSelectElement;
  expect(site.value).toBe("a");
  const choices = screen.getByTestId("enrolment-batch-select");
  expect(within(choices).getByRole("option", { name: /Morning.*North/ })).toBeTruthy();
  expect(within(choices).queryByRole("option", { name: /South|Denied/ })).toBeNull();
  fireEvent.change(site, { target: { value: "b" } });
  expect(within(choices).getByRole("option", { name: /Morning.*South/ })).toBeTruthy();
  expect(within(choices).queryByRole("option", { name: /Denied/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  expect((screen.getByTestId("transfer-target") as HTMLSelectElement).value).toBe("home");
  expect(within(screen.getByTestId("transfer-target")).queryByRole("option", { name: /South|Denied/ })).toBeNull();
});

it("shows each current batch's actual site regardless of the destination picker", () => {
  const current = [
    { batchId: "home", batchName: "Morning", programName: "Swimming", enrolledOn: "2026-01-01" },
    { batchId: "other", batchName: "Morning", programName: "Swimming", enrolledOn: "2026-01-01" },
    { batchId: "wide", batchName: "Open", programName: "Swimming", enrolledOn: "2026-01-01" },
    { batchId: "missing", batchName: "Unknown", programName: "Swimming", enrolledOn: "2026-01-01" },
    { batchId: "no-name", batchName: "Unnamed site", programName: "Swimming", enrolledOn: "2026-01-01" },
  ];
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", enrolments: current, batches: [...batches, { ...batches[0]!, id: "extra", name: "Another" }, { ...batches[0]!, id: "no-name", locationName: null }] }} />);
  expect(screen.getByText("Morning — Swimming · North")).toBeTruthy();
  expect(screen.getByText("Morning — Swimming · South")).toBeTruthy();
  expect(screen.getByText("Open — Swimming · Club-wide")).toBeTruthy();
  expect(screen.getByText("Unknown — Swimming · Facility unavailable")).toBeTruthy();
  expect(screen.getByText("Unnamed site — Swimming · Facility unavailable")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Enrolment facility"), { target: { value: "b" } });
  expect(screen.getByText("Morning — Swimming · North")).toBeTruthy();
  expect(screen.getByText("Morning — Swimming · South")).toBeTruthy();
});

it("applies the same facility policy after retry", async () => {
  actions.batches.mockResolvedValue(batches);
  actions.enrolments.mockResolvedValue(enrolments);
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", failed: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(/Existing/)).toBeTruthy();
  expect(within(screen.getByTestId("enrolment-batch-select")).queryByRole("option", { name: /South|Denied/ })).toBeNull();
  expect(actions.batches).toHaveBeenCalledWith();
});

it("submits the deliberately chosen site and displays a server refusal", async () => {
  actions.enrol.mockResolvedValue({ ok: false, error: "Member or batch not found." });
  actions.transfer.mockResolvedValue({ kind: "error", message: "Member or batch not found." });
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", enrolments, batches }} />);
  fireEvent.change(screen.getByLabelText("Enrolment facility"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Enrol" }));
  expect(await screen.findByText("Member or batch not found.")).toBeTruthy();
  expect(actions.enrol).toHaveBeenCalledWith({ memberId: "m", batchId: "other" });
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  fireEvent.change(screen.getByLabelText("Transfer facility"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  await waitFor(() => expect(screen.getAllByText("Member or batch not found.")).toHaveLength(2));
  expect(actions.transfer).toHaveBeenCalledWith({ memberId: "m", fromBatchId: "existing", toBatchId: "other" });
});

it("includes authorized club-wide batches without hiding them when changing site", () => {
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", enrolments, batches }} />);
  const choices = screen.getByTestId("enrolment-batch-select");
  expect(within(choices).getByRole("option", { name: /Open.*Club-wide/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Enrolment facility"), { target: { value: "b" } });
  expect(within(choices).getByRole("option", { name: /Open.*Club-wide/ })).toBeTruthy();
});

it("keeps the selected destination and shows recovery when requests reject", async () => {
  actions.enrol.mockRejectedValue(new Error("network"));
  actions.transfer.mockRejectedValue(new Error("network"));
  render(<MemberEnrolmentPanel memberId="m" terminology={terminology} canEnrol canWaitlist={false} facility={facility} initialData={{ memberId: "m", enrolments, batches }} />);
  fireEvent.change(screen.getByLabelText("Enrolment facility"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Enrol" }));
  expect(await screen.findByText(/Could not complete enrolment/)).toBeTruthy();
  expect((screen.getByTestId("enrolment-batch-select") as HTMLSelectElement).value).toBe("other");
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  fireEvent.change(screen.getByLabelText("Transfer facility"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(await screen.findByText(/Could not complete transfer/)).toBeTruthy();
  expect((screen.getByTestId("transfer-target") as HTMLSelectElement).value).toBe("other");
});
