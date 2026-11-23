// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/people", () => ({ createMemberAction: vi.fn(), searchPersonsAction: vi.fn() }));
import { createMemberAction } from "@/lib/actions/people";
import { MemberCreateForm } from "@/components/member-create-form";

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("summarises missing required fields with links and inline feedback while focusing the first invalid field", () => {
  render(<MemberCreateForm locations={[]} initialLocationId="" terminology={{ locale: "en", overrides: {} }} />);
  fireEvent.click(screen.getByTestId("submit-member"));
  const summary = screen.getByRole("region", { name: /check the following/i });
  expect(within(summary).getByRole("link", { name: /full name/i }).getAttribute("href")).toBe("#member-full-name-field");
  expect(within(summary).getByRole("link", { name: /date of birth/i }).getAttribute("href")).toBe("#member-dob");
  expect(within(summary).getByRole("link", { name: /location/i }).getAttribute("href")).toBe("#member-location-field");
  expect(within(summary).getByRole("link", { name: /consent/i }).getAttribute("href")).toBe("#member-consent-processing");
  expect(screen.getByTestId("member-full-name").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByTestId("member-dob").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(screen.getByTestId("member-full-name"));
  expect(createMemberAction).not.toHaveBeenCalled();
});
it("focuses an error link without treating it as leaving a dirty draft", () => {
  render(<MemberCreateForm locations={[{ id: "l1", name: "Main" }]} terminology={{ locale: "en", overrides: {} }} />);
  fireEvent.change(screen.getByTestId("member-full-name"), { target: { value: "Existing draft" } });
  fireEvent.click(screen.getByTestId("submit-member"));
  const summary = screen.getByRole("region", { name: /check the following/i });
  fireEvent.click(within(summary).getByRole("link", { name: /date of birth/i }));
  expect(document.activeElement).toBe(screen.getByTestId("member-dob"));
  expect(screen.queryByRole("dialog", { name: /discard changes/i })).toBeNull();
  expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe("Existing draft");
});
it("shows a guardian correction for a minor without losing consent or existing details", () => {
  render(<MemberCreateForm locations={[{ id: "l1", name: "Main" }]} terminology={{ locale: "en", overrides: {} }} />);
  fireEvent.change(screen.getByTestId("member-full-name"), { target: { value: "Existing draft" } });
  fireEvent.change(screen.getByTestId("member-dob"), { target: { value: "01/01/2020" } });
  fireEvent.click(screen.getByTestId("consent-checkbox"));
  fireEvent.click(screen.getByTestId("submit-member"));
  const guardian = screen.getByTestId("guardian-search");
  expect(guardian.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(guardian);
  expect(within(screen.getByRole("region", { name: /check the following/i })).getByRole("link", { name: "Guardian" }).getAttribute("href")).toBe("#guardian-search-field");
  expect((screen.getByTestId("consent-checkbox") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe("Existing draft");
  expect(createMemberAction).not.toHaveBeenCalled();
});
it("points to consent and provides inline feedback without marking optional communications required", () => {
  render(<MemberCreateForm locations={[{ id: "l1", name: "Main" }]} terminology={{ locale: "en", overrides: {} }} />);
  fireEvent.change(screen.getByTestId("member-full-name"), { target: { value: "Existing draft" } });
  fireEvent.change(screen.getByTestId("member-dob"), { target: { value: "01/01/1990" } });
  fireEvent.click(screen.getByTestId("submit-member"));
  expect(document.activeElement).toBe(screen.getByTestId("consent-checkbox"));
  expect(screen.getByTestId("consent-checkbox").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByTestId("consent-checkbox").getAttribute("aria-describedby")).toBe("member-consent-processing-error");
  expect(screen.getByText(/consent to data processing is required/i)).toBeTruthy();
  expect((screen.getByTestId("communications-consent-checkbox") as HTMLInputElement).required).toBe(false);
  fireEvent.click(screen.getByTestId("consent-checkbox"));
  expect(screen.getByTestId("consent-checkbox").getAttribute("aria-invalid")).toBeNull();
  expect(screen.queryByText(/consent to data processing is required/i)).toBeNull();
  expect((screen.getByTestId("communications-consent-checkbox") as HTMLInputElement).checked).toBe(false);
});
