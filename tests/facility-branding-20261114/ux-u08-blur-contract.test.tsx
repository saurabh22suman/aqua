// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PhoneField } from "@/components/auth/phone-field";
import { SelfSignInForm } from "@/components/self-access-form";

afterEach(cleanup);

it("notifies its caller when an invalid phone field blurs", () => {
  const onBlur = vi.fn();
  render(<PhoneField id="phone-contract" value="abc 9876543210" onChange={vi.fn()} onBlur={onBlur} />);
  fireEvent.blur(screen.getByLabelText("Mobile number"));
  expect(onBlur).toHaveBeenCalledTimes(1);
});

it("retains invalid letters in self sign-in after blur", () => {
  render(<SelfSignInForm audience="member" />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.change(phone, { target: { value: "abc 9876543210" } });
  fireEvent.blur(phone);
  expect(phone.value).toBe("abc 9876543210");
});
