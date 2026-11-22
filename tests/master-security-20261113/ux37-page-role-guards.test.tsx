import { expect, it, vi } from "vitest";
const guard = vi.hoisted(() => ({ coach: vi.fn(), reception: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireCoach: guard.coach, requireReception: guard.reception }));
vi.mock("@/components/announcements/staff-inbox-page", () => ({ StaffInboxPage: () => null }));
import CoachPage from "@/app/(coach)/coach/announcements/page";
import ReceptionPage from "@/app/(reception)/reception/announcements/page";

it("refuses a caller denied the coach surface before rendering the inbox", async () => {
  guard.coach.mockRejectedValueOnce(new Error("coach denied"));
  await expect(async () => { await CoachPage(); }).rejects.toThrow("coach denied");
});

it("refuses a caller denied the reception surface before rendering the inbox", async () => {
  guard.reception.mockRejectedValueOnce(new Error("reception denied"));
  await expect(async () => { await ReceptionPage(); }).rejects.toThrow("reception denied");
});
