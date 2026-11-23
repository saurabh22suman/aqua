// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ denied: false, listed: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => { if (guard.denied) throw new Error("DENIED"); } }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: () => true }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: guard.listed, createLocationAction: vi.fn(), updateLocationAction: vi.fn() }));
vi.mock("@/components/settings/business-hours-editor", () => ({ BusinessHoursEditor: () => <p>Hours</p> }));
vi.mock("@/components/owner-ui/owner-page", () => ({ OwnerPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1> }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

import LocationsSettingsPage from "@/app/(owner)/owner/settings/locations/page";

const north = "11111111-1111-4111-8111-111111111111";
const south = "22222222-2222-4222-8222-222222222222";
afterEach(() => { cleanup(); guard.denied = false; guard.listed.mockReset(); });

it("offers a separately identified financial-settings destination for each physical site", async () => {
  guard.listed.mockResolvedValue([
    { id: north, name: "North site", kind: "club", isPrimary: true, address: null },
    { id: south, name: "South site", kind: "club", isPrimary: false, address: null },
  ]);
  render(await LocationsSettingsPage());
  for (const [name, id] of [["North site", north], ["South site", south]]) {
    const site = screen.getByRole("heading", { name }).closest("section");
    expect(site).not.toBeNull();
    fireEvent.click(within(site!).getByText(name));
    const link = within(site!).getByRole("link", { name: `Financial settings for ${name}` });
    expect(link.getAttribute("href")).toBe(`/owner/settings/locations/${id}`);
  }
  expect(screen.queryByRole("link", { name: /all facilities.*financial settings/i })).toBeNull();
});

it("refuses a denied owner before listing facility information", async () => {
  guard.denied = true;
  await expect(LocationsSettingsPage()).rejects.toThrow("DENIED");
  expect(guard.listed).not.toHaveBeenCalled();
});
