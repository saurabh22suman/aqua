// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/branding", () => ({ uploadBrandingAssetAction: mocks.upload }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/components/self-sign-out", () => ({ SelfSignOut: () => null }));
import { BrandAssetUpload } from "@/components/branding/brand-asset-upload";
import { SelfHome } from "@/components/self-home";
import { isInstallInvitationSurface } from "@/lib/offline/install-prompt";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const tenantId = "0190c000-0000-7000-8000-000000000001";
it.each([["member", "self_session", "member"], ["guardian", "self_session", "guardian"], ["guardian", "staff_session", "staff"]] as const)("links %s %s to the correct private install source", (audience, scopeKind, source) => {
  render(<SelfHome view={{ clubName: "Example Club", audience, entries: [] }} audience={audience} scopeKind={scopeKind} tenantId={tenantId} />);
  expect(screen.getByRole("link", { name: "Install this club" }).getAttribute("href")).toBe(`/clubs/${tenantId}/install?source=${source}`);
});
it("suppresses the generic install ribbon only on the club install page", () => {
  expect(isInstallInvitationSurface(`/clubs/${tenantId}/install`)).toBe(false);
  expect(isInstallInvitationSurface("/member")).toBe(true);
});
it.each([true, false])("keeps truthful upload feedback when refresh throws (confirmed=%s)", async (confirmed) => {
  if (confirmed) mocks.upload.mockResolvedValue({ ok: true });
  else mocks.upload.mockRejectedValue(new Error("unknown outcome"));
  mocks.refresh.mockImplementation(() => { throw new Error("refresh unavailable"); });
  render(<BrandAssetUpload kind="logo" />);
  fireEvent.change(screen.getByLabelText("Club logo"), { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));
  expect((await screen.findByRole(confirmed ? "status" : "alert")).textContent).toContain(confirmed ? "Saved." : "could not confirm the upload");
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
