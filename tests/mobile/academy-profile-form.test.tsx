// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Club identity and billing have separate editors. Profile saves must preserve
// draft/error behavior and must never overwrite the billing editor's GSTIN.

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
  it("renders identity fields without a competing GSTIN editor", () => {
    render(<AcademyProfileForm initial={INITIAL} />);
    expect(screen.getByLabelText("Club name")).toBeTruthy();
    expect(screen.getByText("INR")).toBeTruthy();
    expect(screen.getByText("India Standard Time (IST)")).toBeTruthy();
    expect(screen.getByText(/not editable here/i)).toBeTruthy();
    expect(screen.queryByLabelText(/GSTIN/)).toBeNull();
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
  });

  it("submits trimmed identity without GSTIN and retains the draft on server refusal", async () => {
    updateTenantProfileAction.mockResolvedValue({
      kind: "error",
      code: "invalid",
      message: "Club name is invalid.",
    });
    render(<AcademyProfileForm initial={INITIAL} />);

    fireEvent.change(screen.getByLabelText("Club name"), {
      target: { value: "  Updated Club  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Club name is invalid.",
    );
    expect((screen.getByLabelText("Club name") as HTMLInputElement).value).toBe("  Updated Club  ");
    expect(updateTenantProfileAction).toHaveBeenCalledWith({
      name: "Updated Club",
      timezone: "Asia/Kolkata",
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
