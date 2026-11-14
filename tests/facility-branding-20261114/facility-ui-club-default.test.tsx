// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
const profileSave = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/tenant-profile", () => ({ getTenantProfileAction: async () => ({ name: "Test Club", currency: "INR", timezone: "Asia/Kolkata", gstin: null }), updateTenantProfileAction: profileSave }));
vi.mock("@/lib/actions/facility-billing", () => ({ getClubBillingDefaultAction: async () => ({ ok: true, value: { legalName: null, legalAddress: null, stateCode: null, gstin: null } }), saveClubBillingDefaultAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/owner-ui/owner-page", () => ({ OwnerPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1> }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => null }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import AcademySettingsPage from "@/app/(owner)/owner/settings/academy/page";
afterEach(() => { cleanup(); profileSave.mockReset(); });

it("provides explicit club-wide legal issuer fields without inventing legacy values", async () => {
  render(await AcademySettingsPage());
  const legalName = screen.getByRole("textbox", { name: /billing legal name/i }) as HTMLInputElement;
  expect(legalName.value).toBe("");
  expect(screen.getByRole("heading", { name: /club default.*financial identity/i })).toBeTruthy();
  expect(screen.getAllByLabelText(/gstin/i)).toHaveLength(1);
});

it("saves the general profile without submitting a stale GSTIN", async () => {
  profileSave.mockResolvedValue({ kind: "ok" });
  render(await AcademySettingsPage());
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Updated Club" } });
  fireEvent.click(screen.getByRole("button", { name: "Save academy profile" }));
  await waitFor(() => expect(profileSave).toHaveBeenCalledOnce());
  expect(profileSave).toHaveBeenCalledWith({ name: "Updated Club", timezone: "Asia/Kolkata" });
});
