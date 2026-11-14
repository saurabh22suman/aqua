// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/locations", () => ({ createLocationAction: vi.fn(), listAdminLocationsAction: vi.fn(), updateLocationAction: vi.fn() }));
vi.mock("@/components/settings/business-hours-editor", () => ({ BusinessHoursEditor: () => <p>Weekly hours editor</p> }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));
import { LocationManager } from "@/components/settings/location-manager";
afterEach(cleanup);
it("keeps each named site's billing entry available without opening its weekly-hours editor", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  render(<LocationManager canWrite initial={[{ id, name: "Bengaluru centre", kind: "club", isPrimary: false, address: null, createdAt: "2026-11-14T00:00:00Z" }]} />);
  const link = screen.getByRole("link", { name: "Financial settings for Bengaluru centre", hidden: true });
  expect(link.getAttribute("href")).toBe(`/owner/settings/locations/${id}`);
  expect(link.closest("details:not([open])")).toBeNull();
});
