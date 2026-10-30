// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Final Settings interior slice — the reference puts the existing price
// catalogue first and reveals one bounded editor on demand, with the
// refusal meaning and the booking-desk destination visible below it.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});
vi.mock("@/lib/actions/booking-price-admin", () => ({
  saveBookingPriceRuleAction: vi.fn(async () => ({ ok: true as const })),
  setBookingPriceRuleActiveAction: vi.fn(async () => ({ ok: true as const })),
}));

import { BookingPriceManager } from "@/components/bookings/booking-price-manager";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";
import type { TerminologyState } from "@/lib/terminology/keys";

const RULE: BookingPriceRuleRow = {
  id: "rule-1",
  label: "Evening court",
  facilityId: "fac-1",
  facilityName: "Main court",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "16:00",
  endTime: "20:00",
  pricePaise: 50_000,
  priority: 1,
  isActive: true,
};

afterEach(cleanup);

it("puts the catalogue first and reveals only one editor on demand", () => {
  render(<BookingPriceManager facilities={[]} rules={[RULE]} />);

  expect(screen.getByTestId("price-rule-row").textContent).toContain(
    "Evening court",
  );
  expect(screen.queryByTestId("price-rule-label")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Add price rule/i }));
  expect(screen.getByTestId("price-rule-label")).toBeTruthy();
});

it("shows the refusal meaning and opens the booking desk", () => {
  render(<BookingPriceManager facilities={[]} rules={[RULE]} />);
  expect(document.body.textContent).toContain(
    "existing bookings retain their quoted price",
  );
  const desk = screen.getByRole("link", { name: /Open booking desk/i });
  expect(desk.getAttribute("href")).toBe("/owner/bookings");
});

it("exposes the catalogue columns as readable labels", () => {
  render(<BookingPriceManager facilities={[]} rules={[RULE]} />);
  for (const label of ["Rule", "Facility", "Applies", "Price"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});
it("opens the editor directly for an empty catalogue and points below", () => {
  render(<BookingPriceManager facilities={[]} rules={[]} />);
  expect(screen.getByTestId("price-rule-label")).toBeTruthy();
  expect(document.body.textContent).toContain("Add one below");
});

it("keeps a success notice visible after the editor closes", async () => {
  render(<BookingPriceManager facilities={[]} rules={[RULE]} />);
  fireEvent.click(screen.getByRole("button", { name: /Add price rule/i }));
  fireEvent.change(screen.getByTestId("price-rule-label"), {
    target: { value: "Morning court" },
  });
  fireEvent.change(screen.getByTestId("price-rule-price"), {
    target: { value: "400" },
  });
  fireEvent.click(screen.getByTestId("price-rule-save"));
  expect(await screen.findByText("Price saved.")).toBeTruthy();
  expect(screen.queryByTestId("price-rule-label")).toBeNull();
});
const SWIM_TERMINOLOGY: TerminologyState = {
  locale: "en",
  overrides: { facility: { en: { one: "lane", other: "lanes" } } },
};

it("resolves the facility column through manager-provided swim vocabulary", () => {
  render(
    <BookingPriceManager
      facilities={[]}
      rules={[RULE]}
      terminology={SWIM_TERMINOLOGY}
    />,
  );
  expect(screen.getByText("Lane")).toBeTruthy();
  expect(screen.queryByText("Facility")).toBeNull();
});
it("makes the active rule row a 44px label target with a 20px checkbox", () => {
  render(<BookingPriceManager facilities={[]} rules={[RULE]} />);
  fireEvent.click(screen.getByRole("button", { name: /Add price rule/i }));
  const checkbox = screen.getByTestId("price-rule-active") as HTMLInputElement;
  const label = checkbox.closest("label");
  expect(label?.className).toContain("min-h-11");
  expect(checkbox.className).toContain("h-5");
  expect(checkbox.className).toContain("w-5");
  expect(checkbox.className).toContain("accent-[var(--accent-strong)]");
  expect(checkbox.checked).toBe(true);
  fireEvent.click(label!);
  expect(checkbox.checked).toBe(false);
});
