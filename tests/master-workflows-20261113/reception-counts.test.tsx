// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const getRosterAction = vi.fn();
const markAttendanceSessionAction = vi.fn();
vi.mock("@/lib/actions/coach", () => ({
  getRosterAction: (...args: unknown[]) => getRosterAction(...args),
  markAttendanceSessionAction: (...args: unknown[]) => markAttendanceSessionAction(...args),
}));
import { ReceptionCheckIns } from "@/components/reception-check-ins";

const session = { id: "s1", batchName: "Batch", startsAt: "2026-11-13T01:30:00Z", endsAt: "2026-11-13T02:30:00Z", marked: 1, total: 2 };
const rows = [
  { memberId: "m1", name: "Absent learner", code: "001", status: "absent", markedAt: null, pct: null, isTrial: false },
  { memberId: "m2", name: "Unmarked learner", code: "002", status: null, markedAt: null, pct: null, isTrial: false },
];
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("labels absent marks as register completion, not people checked in", async () => {
  getRosterAction.mockResolvedValue({ rows });
  render(<ReceptionCheckIns sessions={[session]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  await screen.findByText("Absent");
  expect(screen.getByTestId("checkin-session-s1").textContent).toContain("1 / 2 marked");
  expect(screen.getByTestId("reception-checkins").textContent).not.toContain("1 checked in");
});

it("updates register completion after a confirmed check-in", async () => {
  getRosterAction.mockResolvedValue({ rows });
  markAttendanceSessionAction.mockResolvedValue({ ok: true });
  render(<ReceptionCheckIns sessions={[session]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  fireEvent.click(await screen.findByRole("button", { name: "Check in Unmarked learner" }));
  await waitFor(() => expect(screen.getByTestId("checkin-session-s1").textContent).toContain("2 / 2 marked"));
  expect(screen.getByTestId("reception-checkins").textContent).toContain("2 marked");
});

it("does not increment on a rejected check-in", async () => {
  getRosterAction.mockResolvedValue({ rows });
  markAttendanceSessionAction.mockResolvedValue({ ok: false, error: "Not saved" });
  render(<ReceptionCheckIns sessions={[session]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  fireEvent.click(await screen.findByRole("button", { name: "Check in Unmarked learner" }));
  await screen.findByRole("alert");
  expect(screen.getByTestId("checkin-session-s1").textContent).toContain("1 / 2 marked");
});

it("counts present, late and absent as marks but leaves unmarked people out", async () => {
  getRosterAction.mockResolvedValue({rows:[
    {...rows[0],memberId:"p",name:"Present person",status:"present"},
    {...rows[0],memberId:"l",name:"Late person",status:"late"},
    {...rows[0],memberId:"a",name:"Absent person",status:"absent"},
    {...rows[1],memberId:"u",name:"Unmarked person"},
  ]});
  render(<ReceptionCheckIns sessions={[{...session,marked:3,total:4}]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  await screen.findByText("Absent");
  expect(screen.getByTestId("checkin-session-s1").textContent).toContain("3 / 4 marked");
  expect(screen.getByTestId("reception-checkins").textContent).toContain("3 marked");
});

it("does not increment when the mark request throws", async () => {
  getRosterAction.mockResolvedValue({ rows });
  markAttendanceSessionAction.mockRejectedValue(new Error("response lost"));
  render(<ReceptionCheckIns sessions={[session]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  fireEvent.click(await screen.findByRole("button", {name:"Check in Unmarked learner"}));
  await screen.findByRole("alert");
  expect(screen.getByTestId("checkin-session-s1").textContent).toContain("1 / 2 marked");
});
it("identifies each session's authorized physical venue in the task row", () => {
  render(<ReceptionCheckIns sessions={[{...session,locationName:"North venue"},{...session,id:"s2",locationName:"South venue"}]} canMark={false} />);
  expect(screen.getByTestId("checkin-session-s1").textContent).toContain("North venue");
  expect(screen.getByTestId("checkin-session-s2").textContent).toContain("South venue");
});
it("does not double-count repeated check-in activation while a mark is pending", async () => {
  getRosterAction.mockResolvedValue({ rows });
  let settle!: (result:{ok:boolean}) => void;
  markAttendanceSessionAction.mockImplementation(() => new Promise(resolve => {settle = resolve;}));
  render(<ReceptionCheckIns sessions={[session]} canMark />);
  fireEvent.click(screen.getByTestId("checkin-session-s1"));
  const button = await screen.findByRole("button",{name:"Check in Unmarked learner"});
  fireEvent.click(button);
  fireEvent.click(button);
  expect(markAttendanceSessionAction).toHaveBeenCalledTimes(1);
  settle({ok:true});
  await waitFor(() => expect(screen.getByTestId("checkin-session-s1").textContent).toContain("2 / 2 marked"));
});
