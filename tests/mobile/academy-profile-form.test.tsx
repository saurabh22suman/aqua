// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR2-C1 — the academy profile form must let the owner fix a typo'd
// GSTIN and show the server's field error without losing the input.

const updateTenantProfileAction = vi.fn();
vi.mock("@/lib/actions/tenant-profile", () => ({
  updateTenantProfileAction: (...args: unknown[]) =>
    updateTenantProfileAction(...args),
}));

import { AcademyProfileForm } from "@/components/settings/academy-profile-form";

const INITIAL = {
  name: "Aqua Worli Aquatic Club",
  currency: "INR",
  timezone: "Asia/Kolkata",
  gstin: "",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AcademyProfileForm (PR2-C1)", () => {
  it("renders the editable identity fields including GSTIN", () => {
    render(<AcademyProfileForm initial={INITIAL} />);
    expect(screen.getByLabelText("Academy name")).toBeTruthy();
    expect(screen.getByLabelText(/^Currency/)).toBeTruthy();
    expect(screen.getByLabelText(/^Time zone/)).toBeTruthy();
    expect(screen.getByLabelText(/GSTIN/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
  });

  it("submits the trimmed values and shows the server's GSTIN error", async () => {
    updateTenantProfileAction.mockResolvedValue({
      kind: "error",
      code: "invalid",
      message: "GSTIN format is invalid.",
    });
    render(<AcademyProfileForm initial={INITIAL} />);

    fireEvent.change(screen.getByLabelText(/GSTIN/), {
      target: { value: "NOT-A-GSTIN" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "GSTIN format is invalid.",
    );
    expect(updateTenantProfileAction).toHaveBeenCalledWith({
      name: "Aqua Worli Aquatic Club",
      currency: "INR",
      timezone: "Asia/Kolkata",
      gstin: "NOT-A-GSTIN",
    });
  });

  it("shows a saved confirmation on success", async () => {
    updateTenantProfileAction.mockResolvedValue({ kind: "ok" });
    render(<AcademyProfileForm initial={INITIAL} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Saved.",
    );
  });
});
