// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/reports/collections", useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock("@/components/facility-navigation", () => ({ navigateFacility: vi.fn() }));
import { FacilitySwitcher } from "@/components/facility-switcher";
const locations = [{ id: "11111111-1111-4111-8111-111111111111", name: "First" }, { id: "22222222-2222-4222-8222-222222222222", name: "Second" }];
afterEach(() => { cleanup(); query.value = ""; });
it("hides the global picker on Daily close and retains it on Trends", () => {
  const view = render(<FacilitySwitcher locations={locations} />);
  expect(screen.queryByTestId("facility-switcher")).toBeNull();
  query.value = "view=trends";
  view.rerender(<FacilitySwitcher locations={locations} />);
  expect(screen.getByTestId("facility-switcher")).toBeTruthy();
});
