// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AttendanceRange } from "@/components/reports/owner-approved/attendance-range";

afterEach(cleanup);

it.each(["all", "22222222-2222-4222-8222-222222222222"])("groups both complete calendar fields independently of the range selector and submits %s scope", facility => {
  render(<AttendanceRange period="last7" from="2026-10-26" to="2026-11-01" facility={facility} />);
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "custom" } });
  const dates = screen.getByRole("group", { name: "Custom dates" });
  const from = within(dates).getByLabelText("From") as HTMLInputElement;
  const to = within(dates).getByLabelText("To") as HTMLInputElement;
  expect(from.value).toBe("26/10/2026"); expect(to.value).toBe("01/11/2026");
  expect(from.readOnly).toBe(true); expect(to.readOnly).toBe(true);
  expect(within(dates).getByRole("button", { name: "Choose start date" })).toBeTruthy();
  expect(within(dates).getByRole("button", { name: "Choose end date" })).toBeTruthy();
  const form = screen.getByRole("button", { name: "Apply" }).closest("form")!;
  expect(Object.fromEntries(new FormData(form))).toEqual({ period: "custom", from: "2026-10-26", to: "2026-11-01", facility });
});

it("selects a date using the shared popup and submits its canonical value", () => {
  render(<AttendanceRange period="custom" from="2026-10-26" to="2026-11-01" facility="all" />);
  fireEvent.click(screen.getByRole("button", { name: "Choose start date" }));
  const calendar = screen.getByRole("dialog", { name: "Choose a date" });
  fireEvent.click(within(calendar).getByRole("button", { name: "27 October 2026" }));
  expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("27/10/2026");
  const form = screen.getByRole("button", { name: "Apply" }).closest("form")!;
  expect(Object.fromEntries(new FormData(form))).toEqual({ period: "custom", from: "2026-10-27", to: "2026-11-01", facility: "all" });
});
