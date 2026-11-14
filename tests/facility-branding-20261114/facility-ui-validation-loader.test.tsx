// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/facility-billing", () => ({ saveClubBillingDefaultAction: vi.fn() }));
import { FacilityClubBillingForm } from "@/components/settings/facility-club-billing-form";

afterEach(cleanup);

it("loads the real validation module on interaction and rejects malformed GSTIN", async () => {
  render(<FacilityClubBillingForm initial={{ legalName: null, legalAddress: null, stateCode: null, gstin: null }} />);
  const gstin = screen.getByLabelText("GSTIN (optional)");
  fireEvent.change(gstin, { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  await waitFor(() => expect(gstin.getAttribute("aria-invalid")).toBe("true"));
  expect(document.activeElement).toBe(gstin);
});
