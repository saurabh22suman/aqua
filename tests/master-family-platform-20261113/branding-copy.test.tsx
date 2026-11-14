// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/branding", () => ({ updateBrandingAction: vi.fn(), uploadBrandingAssetAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BrandingForm } from "@/components/branding/branding-form";

afterEach(cleanup);
it("describes the workspace theme without promising immediate changes everywhere", () => {
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  expect(screen.getByText(/buttons, the active navigation and the focus ring follow the workspace theme/i)).toBeTruthy();
  expect(screen.queryByText(/Mint or Lavender/i)).toBeNull();
  expect(screen.queryByText(/everywhere at once/i)).toBeNull();
  expect(screen.getByText(/install.*(may|might|can).*(update|change)/i)).toBeTruthy();
});
