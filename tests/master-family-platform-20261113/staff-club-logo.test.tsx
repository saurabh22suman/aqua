// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/worker" }));
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

it("shows the authorized club logo beside the club name and falls back when the asset fails", () => {
  const props = { clubName: "Example Club", clubLogoUrl: "/api/branding/logo?v=abc" };
  render(<StaffClubContext {...props} />);
  const logo = screen.getByRole("img", { name: /example club logo/i });
  expect(new URL(logo.getAttribute("src")!, "http://localhost:3000").pathname + new URL(logo.getAttribute("src")!, "http://localhost:3000").search).toBe(props.clubLogoUrl);
  expect(screen.getByText("Example Club")).toBeTruthy();
  fireEvent.error(logo);
  expect(screen.queryByRole("img", { name: /example club logo/i })).toBeNull();
  expect(screen.getByText("EC")).toBeTruthy();
});
