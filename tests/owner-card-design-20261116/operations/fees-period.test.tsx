// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FeesPeriodControl } from "@/components/fees/fees-period-control";
afterEach(cleanup);
it("shows the applied period before opening the editor and preserves all scope and ledger filter", () => {
  render(<FeesPeriodControl tab="transactions" from="2026-11-01" to="2026-12-01" facility="all" timezone="Asia/Kolkata" method="cash" />);
  const summary = screen.getByRole("group", { name: "Applied period" });
  expect(summary.textContent).toMatch(/Nov/);
  expect(screen.queryByLabelText("From date")).toBeNull();
  fireEvent.click(within(summary).getByRole("button", { name: "Change dates" }));
  expect(screen.getByLabelText("From date")).toBeTruthy();
  const form = screen.getByRole("form", { name: "Collection period" }) as HTMLFormElement;
  const data = new FormData(form);
  expect(data.get("facility")).toBe("all");
  expect(data.get("method")).toBe("cash");
  expect(data.get("to")).toBe("2026-12-01");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(within(summary).getByRole("button", { name: "Change dates" }));
});
