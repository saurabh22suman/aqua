// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn<(url: string) => void>());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { FeesPeriodControl } from "@/components/fees/fees-period-control";

afterEach(() => { cleanup(); push.mockClear(); });

it("shows day-first dates and submits the inclusive through date as an exclusive end", () => {
  render(<FeesPeriodControl tab="transactions" from="2026-10-01" to="2026-10-11" facility="site-a" timezone="Asia/Kolkata" method="cash" />);
  expect(screen.getByLabelText("From date")).toHaveProperty("value", "01/10/2026");
  expect(screen.getByLabelText("Through date")).toHaveProperty("value", "10/10/2026");
  fireEvent.change(screen.getByLabelText("Through date"), { target: { value: "12/10/2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
  const url = new URL(push.mock.calls[0]![0], "http://localhost");
  expect(url.searchParams.get("from")).toBe("2026-10-01");
  expect(url.searchParams.get("to")).toBe("2026-10-13");
  expect(url.searchParams.get("facility")).toBe("site-a");
  expect(url.searchParams.get("method")).toBe("cash");
});

it("refuses a through date before the start without navigating", () => {
  render(<FeesPeriodControl tab="overview" from="2026-10-01" to="2026-10-11" timezone="Asia/Kolkata" />);
  fireEvent.change(screen.getByLabelText("Through date"), { target: { value: "30/09/2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
  expect(screen.getByRole("alert").textContent).toBe("Choose a valid date range.");
  expect(push).not.toHaveBeenCalled();
});
