// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ save: vi.fn() }));
const loader = vi.hoisted(() => vi.fn());
vi.mock("@/components/settings/facility-billing-validation-loader", () => ({ loadFacilitySchemas: loader }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/facility-billing", () => ({ saveClubBillingDefaultAction: service.save }));
import { FacilityClubBillingForm } from "@/components/settings/facility-club-billing-form";

const initial = { legalName: null, legalAddress: null, stateCode: null, gstin: null };
beforeEach(() => { loader.mockImplementation(() => vi.importActual("@/lib/services/facility-billing-contract")); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("validates incomplete address and focuses the first invalid field", async () => {
  render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Legal address line 1"), { target: { value: "One Road" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  const city = screen.getByLabelText("City");
  await waitFor(() => expect(city.getAttribute("aria-invalid")).toBe("true"));
  expect(city.getAttribute("aria-describedby")).toBe("club-billing-city-error");
  await waitFor(() => expect(document.activeElement).toBe(city));
  expect(service.save).not.toHaveBeenCalled();
});

it("previews affected inheriting sites and retains draft after refusal", async () => {
  service.save.mockResolvedValue({ ok: false, code: "open_orders", message: "Finish billing open café orders first." });
  render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  const dialog = await screen.findByRole("dialog", { name: "Review club default" });
  expect(dialog.textContent).toMatch(/facilities that inherit/i);
  expect(dialog.textContent).toMatch(/Example legal/);
  fireEvent.click(screen.getByRole("button", { name: "Save club default" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/open café orders/i));
  expect((screen.getByLabelText("Billing legal name") as HTMLInputElement).value).toBe("Example legal");
});

it("associates a malformed GSTIN with its field and preserves the correction draft", async () => {
  render(<FacilityClubBillingForm initial={initial} />);
  const gstin = screen.getByLabelText("GSTIN (optional)");
  fireEvent.change(gstin, { target: { value: "not-a-gstin" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  await waitFor(() => expect(gstin.getAttribute("aria-invalid")).toBe("true"));
  expect(gstin.getAttribute("aria-describedby")).toBe("club-billing-gstin-error");
  await waitFor(() => expect(document.activeElement).toBe(gstin));
  expect((gstin as HTMLInputElement).value).toBe("not-a-gstin");
  expect(service.save).not.toHaveBeenCalled();
});

it("retains the draft and permits retry when the validation chunk fails", async () => {
  loader.mockRejectedValueOnce(new Error("chunk load failed"));
  render(<FacilityClubBillingForm initial={initial} />);
  const name = screen.getByLabelText("Billing legal name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was submitted.*try again/i);
  expect(name.value).toBe("Example legal");
  expect(service.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /reload and check/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  expect(await screen.findByRole("dialog", { name: "Review club default" })).toBeTruthy();
});

it("prevents double review while checking and preserves the entered draft", async () => {
  let resolve!: (value: unknown) => void;
  loader.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<FacilityClubBillingForm initial={initial} />);
  const name = screen.getByLabelText("Billing legal name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Example legal" } });
  const button = screen.getByRole("button", { name: "Review club default" });
  fireEvent.click(button); fireEvent.click(button);
  expect(loader).toHaveBeenCalledOnce();
  expect(name.disabled).toBe(true);
  resolve(await vi.importActual("@/lib/services/facility-billing-contract"));
  expect(await screen.findByRole("dialog", { name: "Review club default" })).toBeTruthy();
  expect(name.value).toBe("Example legal");
});

it("does not continue a pending validation after the form unmounts", async () => {
  let resolve!: (value: unknown) => void;
  loader.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  view.unmount();
  const schemas = await vi.importActual("@/lib/services/facility-billing-contract");
  await act(async () => { resolve(schemas); });
  expect(service.save).not.toHaveBeenCalled();
});

it("reports a validation-load failure during confirmation without submitting", async () => {
  render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  await screen.findByRole("dialog", { name: "Review club default" });
  loader.mockRejectedValueOnce(new Error("chunk load failed"));
  fireEvent.click(screen.getByRole("button", { name: "Save club default" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was submitted/i);
  expect((screen.getByLabelText("Billing legal name") as HTMLInputElement).value).toBe("Example legal");
  expect(service.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /reload and check/i })).toBeNull();
});

it("normalises GSTIN for the dedicated billing action while retaining the entered draft after refusal", async () => {
  service.save.mockResolvedValue({ ok: false, code: "open_orders", message: "Finish billing open café orders first." });
  render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Billing state"), { target: { value: "29" } });
  fireEvent.change(screen.getByLabelText("GSTIN (optional)"), { target: { value: "29abcde1234f1z5" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  await screen.findByRole("dialog", { name: "Review club default" });
  fireEvent.click(screen.getByRole("button", { name: "Save club default" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/open café orders/i));
  expect(service.save).toHaveBeenCalledWith({ legalName: null, legalAddress: null, stateCode: "29", gstin: "29ABCDE1234F1Z5" });
  expect((screen.getByLabelText("GSTIN (optional)") as HTMLInputElement).value).toBe("29abcde1234f1z5");
});

it("announces validation checking before opening the review", async () => {
  render(<FacilityClubBillingForm initial={initial} />);
  fireEvent.change(screen.getByLabelText("Billing legal name"), { target: { value: "Example legal" } });
  fireEvent.click(screen.getByRole("button", { name: "Review club default" }));
  expect(screen.getByRole("status").textContent).toMatch(/checking/i);
  expect(await screen.findByRole("dialog", { name: "Review club default" })).toBeTruthy();
});
