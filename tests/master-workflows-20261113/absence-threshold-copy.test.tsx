// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/lib/actions/absence-alerts", () => ({updateAbsenceAlertThresholdAction: vi.fn()}));
import { AlertSettingsForm } from "@/components/alert-settings-form";
import { CONFIG_KEYS } from "@/db/config-definitions";
afterEach(cleanup);
it("describes the threshold consistently as present-or-late attendance below the configured percentage", () => {
  render(<AlertSettingsForm initialThreshold={20} />);
  expect(CONFIG_KEYS["attendance.absence_alert_threshold_pct"].description).toMatch(/attendance.*below/i);
  expect(screen.getByText(/present.*late/i)).toBeTruthy();
  expect(screen.getByText(/40%.*20%.*no.*alert/i)).toBeTruthy();
  expect(screen.getByText(/four marked sessions/i)).toBeTruthy();
});
