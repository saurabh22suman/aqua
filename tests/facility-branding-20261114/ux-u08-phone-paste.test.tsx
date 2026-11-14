// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SelfSignInForm } from "@/components/self-access-form";

afterEach(cleanup);
it.each(["919000000210", "+919000000210"])("shows a local number immediately after recognised paste %s", (pasted) => {
  render(<SelfSignInForm audience="member" />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.paste(phone, { clipboardData: { getData: () => pasted } });
  expect(phone.value.replace(/\D/g, "")).toBe("9000000210");
});
it.each(["9190000002109", "abc919000000210"])("does not intercept invalid or excess clipboard text %s", (pasted) => {
  render(<SelfSignInForm audience="member" />);
  const phone = screen.getByLabelText("Mobile number");
  const event = createEvent.paste(phone, { clipboardData: { getData: () => pasted } });
  fireEvent(phone, event);
  expect(event.defaultPrevented).toBe(false);
});
