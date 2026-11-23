// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FeesPeriodControl } from "@/components/fees/fees-period-control";

afterEach(() => { cleanup(); });

it("shows day-first dates and submits the inclusive through date as an exclusive end", () => {
  render(<FeesPeriodControl tab="transactions" from="2026-10-01" to="2026-10-11" facility="site-a" timezone="Asia/Kolkata" method="cash" />);
  fireEvent.click(screen.getByRole("button", {name:"Change dates"}));
  expect(screen.getByLabelText("From date")).toHaveProperty("value", "01/10/2026");
  expect(screen.getByLabelText("Through date")).toHaveProperty("value", "10/10/2026");
  fireEvent.change(screen.getByLabelText("Through date"), { target: { value: "12/10/2026" } });
  const form=screen.getByRole("form", {name:"Collection period"}) as HTMLFormElement;
  expect(fireEvent.submit(form)).toBe(true);
  const url = new URL(form.action);
  for (const [key,value] of new FormData(form)) url.searchParams.set(key,String(value));
  expect(url.searchParams.get("from")).toBe("2026-10-01");
  expect(url.searchParams.get("to")).toBe("2026-10-13");
  expect(url.searchParams.get("facility")).toBe("site-a");
  expect(url.searchParams.get("method")).toBe("cash");
});

it("refuses a through date before the start without navigating", () => {
  render(<FeesPeriodControl tab="overview" from="2026-10-01" to="2026-10-11" timezone="Asia/Kolkata" />);
  fireEvent.click(screen.getByRole("button", {name:"Change dates"}));
  fireEvent.change(screen.getByLabelText("Through date"), { target: { value: "30/09/2026" } });
  expect(fireEvent.submit(screen.getByRole("form", {name:"Collection period"}))).toBe(false);
  expect(screen.getByRole("alert").textContent).toBe("Choose a valid date range.");

});
