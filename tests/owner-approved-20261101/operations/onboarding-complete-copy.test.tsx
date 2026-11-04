// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import type { OnboardingChecklist } from "@/lib/services/onboarding-checklist";

afterEach(cleanup);
const data: OnboardingChecklist = { items: ["add_members", "create_batch", "assign_coach"].map(key => ({ key: key as "add_members" | "create_batch" | "assign_coach", title: key, detail: "Check", cta: { label: "Open", href: "/owner" }, complete: true })), completedCount: 3, totalCount: 3 };
it("does not promise a next task after all register checks are complete", () => {
  render(<OnboardingChecklistView data={data} />);
  expect(screen.getByText("3 of 3 checks complete")).toBeTruthy();
  expect(screen.queryByText(/one clear next task/i)).toBeNull();
  expect(screen.getByRole("link", { name: /go to owner home/i }).getAttribute("href")).toBe("/owner");
});
