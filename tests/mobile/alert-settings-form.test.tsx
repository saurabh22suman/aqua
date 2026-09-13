// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.8 — owner threshold setting (default 50%, configurable).
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const updateAbsenceAlertThresholdAction = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const })),
);
vi.mock("@/lib/actions/absence-alerts", () => ({
  updateAbsenceAlertThresholdAction,
}));

import { AlertSettingsForm } from "@/components/alert-settings-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlertSettingsForm (R.8)", () => {
  it("shows the current threshold and saves a new one", async () => {
    render(<AlertSettingsForm initialThreshold={50} />);
    const input = screen.getByTestId("alert-threshold") as HTMLInputElement;
    expect(input.value).toBe("50");

    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await vi.waitFor(() =>
      expect(updateAbsenceAlertThresholdAction).toHaveBeenCalledWith({
        thresholdPct: 35,
      }),
    );
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Saved"),
    );
  });

  it("refuses an out-of-range value without calling the action", () => {
    render(<AlertSettingsForm initialThreshold={50} />);
    fireEvent.change(screen.getByTestId("alert-threshold"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateAbsenceAlertThresholdAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("0 to 100");
  });
});
