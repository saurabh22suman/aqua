// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/components/facility-navigation", () => ({ navigateFacility: navigate }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams("facility=11111111-1111-4111-8111-111111111111"),
}));
vi.mock("@/components/ui/Select", () => ({ Select: (props: ComponentProps<"select">) => <select {...props} /> }));
import { FacilitySwitcher } from "@/components/facility-switcher";

afterEach(() => { cleanup(); navigate.mockClear(); });

it("makes All facilities explicit in the URL, even when a device cookie may be stale", () => {
  render(<FacilitySwitcher locations={[
    { id: "11111111-1111-4111-8111-111111111111", name: "First" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Second" },
  ]} />);
  fireEvent.change(screen.getByLabelText("Club"), { target: { value: "all" } });
  expect(navigate).toHaveBeenCalledWith("/owner/members?facility=all");
});
