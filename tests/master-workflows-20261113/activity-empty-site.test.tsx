// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter:() => ({refresh:vi.fn()})}));
vi.mock("@/lib/actions/activities", () => ({addSubUnitAction:vi.fn(),createActivityAction:vi.fn(),deleteActivityAction:vi.fn(),removeSubUnitAction:vi.fn(),updateActivityAction:vi.fn()}));
import { ActivityManager } from "@/components/activity-manager";
afterEach(cleanup);
it("names the top-level site and retains its setup recovery destination", () => {
  render(<ActivityManager locations={[]} activities={[]} />);
  fireEvent.click(screen.getByText("Add resource"));
  expect(screen.getByText(/no physical sites yet/i)).toBeTruthy();
  expect(screen.getByRole("link",{name:/add a physical site/i}).getAttribute("href")).toBe("/owner/settings/locations");
});
