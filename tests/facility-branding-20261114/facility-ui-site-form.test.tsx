// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ save: vi.fn(), reset: vi.fn(), create: vi.fn() }));
const loader = vi.hoisted(() => vi.fn());
vi.mock("@/components/settings/facility-billing-validation-loader", () => ({ loadFacilitySchemas: loader }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/actions/facility-billing", () => ({ saveSiteBillingSettingAction: actions.save, resetSiteBillingSettingAction: actions.reset, createBillingRegistrationAction: actions.create }));
import Link from "next/link";
import { FacilityBillingForm } from "@/components/settings/facility-billing-form";
import type { ClubBillingDefault, SiteBillingSetting } from "@/lib/services/facility-billing-contract";

const site: SiteBillingSetting = { locationId: "11111111-1111-4111-8111-111111111111", locationName: "North site", enabled: false, stateCode: null, choice: { mode: "inherit" }, effectiveIssuer: null, registrations: [] };
const club: ClubBillingDefault = { legalName: "Club", legalAddress: null, stateCode: "27", gstin: null };
beforeEach(() => { loader.mockImplementation(() => vi.importActual("@/lib/services/facility-billing-contract")); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps a legacy site disabled and blocks mismatched inherited state", () => {
  render(<FacilityBillingForm initial={site} club={club} />);
  expect(screen.getByText(/uses the club default for billing/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "29" } });
  expect(screen.getByRole("alert").textContent).toMatch(/does not match/i);
  expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
  expect(actions.save).not.toHaveBeenCalled();
});

it("preserves a draft and shows a service refusal", async () => {
  actions.save.mockResolvedValue({ ok: false, code: "open_orders", message: "Finish billing open café orders first." });
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "27" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/open café orders/i));
  expect((screen.getByLabelText(/facility billing state/i) as HTMLSelectElement).value).toBe("27");
  expect(actions.save).toHaveBeenCalledWith({ locationId: site.locationId, stateCode: "27", choice: { mode: "inherit" }, enable: false });
});

it("associates validation errors and focuses the first invalid field", async () => {
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const state = screen.getByLabelText(/facility billing state/i);
  await waitFor(() => expect(state.getAttribute("aria-invalid")).toBe("true"));
  expect(state.getAttribute("aria-describedby")).toBe("facility-stateCode-error");
  await waitFor(() => expect(document.activeElement).toBe(state));
  expect(actions.save).not.toHaveBeenCalled();
});

it("retains the site draft and retries after validation fails to load", async () => {
  loader.mockRejectedValueOnce(new Error("chunk load failed"));
  actions.save.mockResolvedValue({ ok: false, code: "open_orders", message: "Finish billing open café orders first." });
  render(<FacilityBillingForm initial={site} club={club} />);
  const state = screen.getByLabelText(/facility billing state/i) as HTMLSelectElement;
  fireEvent.change(state, { target: { value: "27" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was submitted.*try again/i);
  expect(state.value).toBe("27"); expect(actions.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /reload and check/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
});

it("prevents double save while validation loads", async () => {
  let resolve!: (value: unknown) => void;
  loader.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  actions.save.mockResolvedValue({ ok: false, code: "open_orders", message: "Finish billing open café orders first." });
  render(<FacilityBillingForm initial={site} club={club} />);
  const state = screen.getByLabelText(/facility billing state/i) as HTMLSelectElement;
  fireEvent.change(state, { target: { value: "27" } });
  const button = screen.getByRole("button", { name: "Save draft" });
  fireEvent.click(button); fireEvent.click(button);
  expect(loader).toHaveBeenCalledOnce(); expect(state.disabled).toBe(true);
  resolve(await vi.importActual("@/lib/services/facility-billing-contract"));
  await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
  expect(state.value).toBe("27");
});

it("does not create a registration when validation fails to load", async () => {
  loader.mockRejectedValueOnce(new Error("chunk load failed"));
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.click(screen.getByRole("radio", { name: "Custom registered" }));
  const name = screen.getByLabelText("Billing legal name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Create registration" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was submitted/i);
  expect(name.value).toBe("Example legal");
  expect(actions.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create registration" }));
  await waitFor(() => expect(screen.getByLabelText("Legal address line 1").getAttribute("aria-invalid")).toBe("true"));
});

it("describes the selected issuer and site before enabling new bills", async () => {
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "27" } });
  fireEvent.click(screen.getByRole("button", { name: "Review and use for new bills" }));
  const dialog = await screen.findByRole("dialog", { name: /review billing for north site/i });
  expect(dialog.textContent).toMatch(/Club default/);
  expect(dialog.textContent).toMatch(/Club/);
  expect(dialog.textContent).toMatch(/Unregistered/);
  expect(dialog.textContent).toMatch(/Maharashtra/);
  expect(actions.save).not.toHaveBeenCalled();
});

it("requires issuer review before saving a change for an enabled site", async () => {
  const enabledSite: SiteBillingSetting = { ...site, enabled: true, stateCode: "27", effectiveIssuer: { legalName: "Current issuer", legalAddress: { line1: "One Road", line2: null, city: "City", postalCode: "400001" }, stateCode: "27", gstin: null } };
  render(<FacilityBillingForm initial={enabledSite} club={club} />);
  fireEvent.click(screen.getByRole("radio", { name: "Unregistered" }));
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: "New issuer" } });
  fireEvent.change(screen.getByLabelText("Legal address line 1"), { target: { value: "Two Road" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "City" } });
  fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "400001" } });
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  const dialog = await screen.findByRole("dialog", { name: /review billing for north site/i });
  expect(dialog.textContent).toMatch(/New issuer/);
  expect(actions.save).not.toHaveBeenCalled();
});

it("offers explicit reload after an unknown save outcome without claiming success", async () => {
  actions.save.mockRejectedValue(new Error("network"));
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "27" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect(screen.getByRole("button", { name: /reload and check saved state/i })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("creates a registration without saving or enabling the facility", async () => {
  const issuer = { legalName: "Example Legal", legalAddress: { line1: "One Road", line2: null, city: "Example City", postalCode: "400001" }, stateCode: "27", gstin: "27ABCDE1234F1Z5" };
  actions.create.mockResolvedValue({ ok: true, value: { id: "33333333-3333-4333-8333-333333333333", issuer } });
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "27" } });
  fireEvent.click(screen.getByRole("radio", { name: "Custom registered" }));
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: issuer.legalName } });
  fireEvent.change(screen.getByLabelText("Legal address line 1"), { target: { value: issuer.legalAddress.line1 } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: issuer.legalAddress.city } });
  fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: issuer.legalAddress.postalCode } });
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: issuer.gstin } });
  fireEvent.click(screen.getByRole("button", { name: "Create registration" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not enabled/i));
  expect(actions.create).toHaveBeenCalledOnce();
  expect(actions.save).not.toHaveBeenCalled();
});

it("presents explicit unregistered details without creating a registration", () => {
  render(<FacilityBillingForm initial={site} club={club} />);
  fireEvent.click(screen.getByRole("radio", { name: "Unregistered" }));
  expect(screen.getByRole("textbox", { name: "Billing legal name" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create registration" })).toBeNull();
  expect(actions.create).not.toHaveBeenCalled();
});

it("offers Stay before following an in-app navigation link and keeps the draft", async () => {
  render(<><FacilityBillingForm initial={site} club={club} /><Link href="/owner/members">Members</Link></>);
  fireEvent.change(screen.getByLabelText(/facility billing state/i), { target: { value: "27" } });
  fireEvent.click(screen.getByRole("link", { name: "Members" }));
  expect(await screen.findByRole("dialog", { name: /discard unsaved billing changes/i })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  expect((screen.getByLabelText(/facility billing state/i) as HTMLSelectElement).value).toBe("27");
});
