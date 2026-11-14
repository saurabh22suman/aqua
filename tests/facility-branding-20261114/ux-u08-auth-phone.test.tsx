// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/auth-ui", () => ({ homeForSessionAction: vi.fn() }));
import { LoginForm } from "@/components/login-form";

afterEach(cleanup);
it("retains invalid staff phone text on blur instead of silently normalising it", () => {
  render(<LoginForm />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.change(phone, { target: { value: "abc 9876543210" } });
  fireEvent.blur(phone);
  expect(phone.value).toContain("abc");
});
it("shows a recognised country-code paste immediately without duplicating the prefix", () => {
  render(<LoginForm />);
  const phone = screen.getByLabelText("Mobile number") as HTMLInputElement;
  fireEvent.paste(phone, { clipboardData: { getData: () => "919000000210" } });
  expect(phone.value.replace(/\D/g, "")).toBe("9000000210");
});
