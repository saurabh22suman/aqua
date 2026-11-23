// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RegisterBoard } from "@/components/register-board";

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({ online: true, offlineAvailable: false, marks: {}, markedCount: 0, pending: 0 }),
}));

it("puts the session in the register controls and identifies each set of attendance choices by member", () => {
  const props = {
    sessionId: "s1", offlineSyncEnabled: false,
    rows: [{ memberId: "m1", name: "Aarav Shah", code: "M1", status: null, pct: 80, isTrial: false }],
    sessionContext: "Junior TTS · 05:00 pm · Worli Main",
  };
  render(<RegisterBoard {...props} />);
  const toolbar = screen.getByRole("region", { name: /Junior TTS.*Worli Main/ });
  expect(within(toolbar).getByRole("button", { name: /mark all/i })).toBeTruthy();
  const choices = screen.getByRole("group", { name: "Attendance for Aarav Shah" });
  expect(within(choices).getByRole("button", { name: "Present" })).toBeTruthy();
});
