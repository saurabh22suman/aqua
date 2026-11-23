// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ site: vi.fn(), club: vi.fn(), denied: false }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => { if (state.denied) throw new Error("DENIED"); } }));
vi.mock("@/lib/actions/facility-billing", () => ({ getSiteBillingSettingAction: state.site, getClubBillingDefaultAction: state.club }));
vi.mock("@/components/settings/facility-billing-form", () => ({ FacilityBillingForm: () => <p>Financial identity editor</p> }));
vi.mock("@/components/owner-ui/owner-page", () => ({ OwnerPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1> }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => null }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import FacilitySettingsPage from "@/app/(owner)/owner/settings/locations/[locationId]/page";

const locationId = "11111111-1111-4111-8111-111111111111";
afterEach(() => { cleanup(); state.site.mockReset(); state.club.mockReset(); state.denied = false; });
it("shows a named authorized site", async () => {
  state.site.mockResolvedValue({ ok: true, value: { locationId, locationName: "North site" } });
  state.club.mockResolvedValue({ ok: true, value: {} });
  render(await FacilitySettingsPage({ params: Promise.resolve({ locationId }) }));
  expect(screen.getByRole("heading", { name: "North site" })).toBeTruthy();
  expect(screen.getByText("Financial identity editor")).toBeTruthy();
});
it("denies before requesting site information", async () => {
  state.denied = true;
  await expect(FacilitySettingsPage({ params: Promise.resolve({ locationId }) })).rejects.toThrow("DENIED");
  expect(state.site).not.toHaveBeenCalled(); expect(state.club).not.toHaveBeenCalled();
});
it("does not reveal whether a foreign or missing site exists", async () => {
  state.site.mockResolvedValue({ ok: false, code: "not_found", message: "not found" });
  state.club.mockResolvedValue({ ok: true, value: {} });
  await expect(FacilitySettingsPage({ params: Promise.resolve({ locationId }) })).rejects.toThrow("NOT_FOUND");
});
it("offers a retry instead of an editor when an authorized read fails", async () => {
  state.site.mockResolvedValue({ ok: false, code: "conflict", message: "unavailable" });
  state.club.mockResolvedValue({ ok: true, value: {} });
  render(await FacilitySettingsPage({ params: Promise.resolve({ locationId }) }));
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(`/owner/settings/locations/${locationId}`);
  expect(screen.queryByText("Financial identity editor")).toBeNull();
});
