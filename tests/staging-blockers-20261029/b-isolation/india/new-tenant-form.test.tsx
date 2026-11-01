// @vitest-environment jsdom
//
// India-first Ops presentation (own scope, items 1–3).
// RED before the form change: currency/timezone are visible text inputs with
// IANA/ISO hints, and the submitted FormData carries operator-editable values.
// The assertion uses the REAL form element's FormData, not a mocked success.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/actions/platform-tenants", () => ({
  createTenantAction: vi.fn(),
}));

import { NewTenantForm } from "@/app/(platform)/ops/tenants/new/new-tenant-form";

const props = {
  defaultTimezone: "Asia/Kolkata",
  defaultCurrency: "INR",
  defaultLocationName: "Main",
  plans: [{ key: "standard", name: "Standard", isDefault: true }],
  defaultPlanKey: "standard",
  presets: [{ key: "swimming", name: "Swimming", description: "" }],
  defaultPresetKey: "swimming",
};

afterEach(cleanup);

describe("new tenant form is India-fixed without visible currency/timezone roles", () => {
  it("submits the required server contract with hidden INR / Asia/Kolkata", () => {
    const { container } = render(<NewTenantForm {...props} />);

    const form = container.querySelector("form");
    expect(form, "the form must render").not.toBeNull();
    const data = new FormData(form!);

    // Required fields survive the presentation change.
    for (const name of ["name", "slug", "planKey", "presetKey", "locationName"]) {
      expect(data.get(name), `${name} must stay in the submitted FormData`).not.toBeNull();
    }
    expect(data.get("currency")).toBe("INR");
    expect(data.get("timezone")).toBe("Asia/Kolkata");

    // The two fixed values are hidden inputs, not operator-editable controls.
    const currency = container.querySelector<HTMLInputElement>('input[name="currency"]');
    const timezone = container.querySelector<HTMLInputElement>('input[name="timezone"]');
    expect(currency?.type).toBe("hidden");
    expect(timezone?.type).toBe("hidden");
    expect(screen.queryByRole("textbox", { name: /currency/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /time zone/i })).toBeNull();

    // Plain-India context replaces the IANA/ISO jargon.
    expect(
      screen.getByText(/New tenants are created with INR and Indian Standard Time/),
    ).toBeDefined();
    expect(screen.getByText(/This new tenant uses IST/)).toBeDefined();
    expect(screen.getByText("Currency · INR")).toBeDefined();
    expect(container.textContent).not.toMatch(/fixed for every tenant in this release|Every tenant runs on IST/i);
    expect(container.textContent).not.toMatch(/ISO 4217|IANA|non-India/i);
  });

  it("keeps GSTIN optional with its existing 15-character contract", () => {
    const { container } = render(<NewTenantForm {...props} />);
    const gstin = screen.getByRole("textbox", { name: /gstin/i });
    expect(gstin.hasAttribute("required")).toBe(false);
    expect(gstin.getAttribute("maxlength")).toBe("15");
    expect(container.textContent).not.toMatch(/non-India/i);
  });
});
