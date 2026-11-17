// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/enquiries", () => ({ createEnquiryAction: create }));
import { EnquiriesBoard } from "@/components/enquiries-board";

beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); create.mockReset(); });

function openCapture() {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "site-a", name: "Kharghar Centre" }]} canWrite variant="oversight" />);
  fireEvent.click(screen.getByRole("button", { name: /add enquiry/i }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Local validation check" } });
  return screen.getByLabelText("Phone (optional)") as HTMLInputElement;
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "Capture enquiry" })); }

it("associates invalid phone feedback with the field without submitting and preserves the draft", async () => {
  const phone = openCapture();
  fireEvent.change(phone, { target: { value: "abcdefgh" } });
  submit();
  expect(create).not.toHaveBeenCalled();
  expect(phone.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(phone);
  const error = document.getElementById(phone.getAttribute("aria-describedby")!);
  expect(error?.textContent).toMatch(/valid phone/i);
  expect(phone.value).toBe("abcdefgh");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Local validation check");
  expect(screen.queryByText(/check the site/i)).toBeNull();
});

it.each(["", "9876543210"])("recovers after correcting the phone to %j and submits it", async (corrected) => {
  const phone = openCapture();
  create.mockResolvedValue({ id: "e1", fullName: "Local validation check", phone: corrected || null, stage: "new", source: "walk-in", createdAt: new Date().toISOString() });
  fireEvent.change(phone, { target: { value: "abcdefgh" } });
  submit();
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(phone, { target: { value: corrected } });
  expect(phone.getAttribute("aria-invalid")).not.toBe("true");
  submit();
  await waitFor(() => expect(create).toHaveBeenCalledWith({ fullName: "Local validation check", phone: corrected || undefined, source: "walk-in", locationId: "site-a" }));
});

it("does not mislabel a server site or permission refusal as a phone error", async () => {
  const phone = openCapture();
  fireEvent.change(phone, { target: { value: "9876543210" } });
  create.mockRejectedValue(new Error("site denied"));
  submit();
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not save the enquiry/i);
  expect(phone.getAttribute("aria-invalid")).not.toBe("true");
  expect(phone.value).toBe("9876543210");
});

it("does not offer capture to a role without write permission", () => {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "site-a", name: "Kharghar Centre" }]} canWrite={false} variant="oversight" />);
  expect(screen.queryByRole("button", { name: /capture enquiry/i })).toBeNull();
  expect(create).not.toHaveBeenCalled();
});
