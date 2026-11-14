// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SelfSignInForm } from "@/components/self-access-form";

afterEach(cleanup);
it("does not silently turn non-digit phone text into a different valid number on blur", () => {
  render(<SelfSignInForm audience="guardian" />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.change(phone, { target: { value: "abc 9876543210" } });
  fireEvent.blur(phone);
  expect(phone.value).toContain("abc");
});
it.each(["9876543210", "919876543210", "+91 98765 43210"])("displays recognised Indian input without duplicating the prefix: %s", (value) => {
  render(<SelfSignInForm audience="member" />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.change(phone, { target: { value } }); fireEvent.blur(phone);
  expect(phone.value.replace(/\D/g, "")).toBe("9876543210");
});
it("does not truncate excess digits into a valid-looking number", () => {
  render(<SelfSignInForm audience="member" />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.change(phone, { target: { value: "987654321099" } }); fireEvent.blur(phone);
  expect(phone.value.replace(/\D/g, "")).toBe("987654321099");
});
