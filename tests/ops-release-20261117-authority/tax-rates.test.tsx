// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaxRates } from "@/app/(platform)/ops/tenants/[tenantId]/tax/tax-rates";
import type { TaxScopeRow } from "@/lib/services/tax";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-tax", () => ({ setTenantTaxRateAction: save }));

const row = (scopeType: TaxScopeRow["scopeType"], label: string, rateBp: number): TaxScopeRow => ({
  scopeType, scopeId: scopeType === "tenant" ? null : label, label, rateBp,
  source: { scopeType: scopeType === "tenant" ? "default" : scopeType, scopeId: null, setBy: null, setAt: null },
});
const config = { tenant: row("tenant", "Club", 1800), locations: [row("location", "Pool", 500)], activities: [row("activity", "Swim", 1200)] };
afterEach(() => { cleanup(); save.mockReset(); });

describe("GST visibility and validation", () => {
  it("shows resolved rates and provenance to readers without mutation controls", () => {
    render(<TaxRates tenantId="tenant" config={config} canWrite={false} />);
    expect(screen.getByText(/18%.*platform default/)).toBeTruthy();
    expect(screen.getByText(/5%.*set at location/)).toBeTruthy();
    expect(screen.getByText(/12%.*set at activity/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });

  it("announces invalid input at its row and clears it when corrected", () => {
    render(<TaxRates tenantId="tenant" config={config} canWrite />);
    const input = screen.getByLabelText("GST percent for Club");
    fireEvent.change(input, { target: { value: "100.001" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    const alert = screen.getByRole("alert");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "100" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each([["0", 0], ["100", 10000], ["0.01", 1]])("saves supported boundary %s", async (value, basisPoints) => {
    save.mockResolvedValue({ ok: true });
    render(<TaxRates tenantId="tenant" config={config} canWrite />);
    const input = screen.getByLabelText("GST percent for Club");
    const row = input.closest(".border-b") as HTMLElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", rateBp: basisPoints })));
    expect((await within(row).findByRole("status")).textContent).toContain("Saved");
  });
  it("announces a server refusal at its row", async () => {
    save.mockResolvedValue({ ok: false, error: "Rate refused." });
    render(<TaxRates tenantId="tenant" config={config} canWrite />);
    const row = screen.getByLabelText("GST percent for Club").closest(".border-b") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect((await within(row).findByRole("alert")).textContent).toContain("Rate refused.");
  });
});
