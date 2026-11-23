// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClubChoice } from "@/components/club-choice";
import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";
import { PremisesCheckInButton } from "@/components/premises-check-in-button";
import { SelfInvitationForm } from "@/components/self-invitation-form";
import { SetPinForm } from "@/components/set-pin-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/auth-ui", () => ({ homeForSessionAction: vi.fn() }));
vi.mock("@/lib/actions/club-selection", () => ({ selectClubAction: vi.fn() }));
vi.mock("@/lib/actions/staff-attendance", () => ({ selfCheckInAction: vi.fn() }));
vi.mock("@/lib/offline/logout", () => ({ syncBeforeLogout: vi.fn() }));
vi.mock("@/lib/offline/client-session", () => ({ clearOfflineData: vi.fn(), runOfflineLifecycle: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("masks both fields while setting a PIN and gives a route to check an unconfirmed save", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<SetPinForm />);
  for (const name of ["PIN", "Confirm PIN"]) {
    const field = screen.getByLabelText(name, { exact: true }) as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "729105" } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect(screen.getByRole("link", { name: "Check by signing in" }).getAttribute("href")).toBe("/login");
});

it("submits staff invitations as a native form and names an interrupted redemption", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<LoginLinkRedeemForm token="sample" phone="+919000000001" roleKey="coach" tenantName="Demo Club"
    expiresAt="21 November" credentialSet purpose="relogin" />);
  const submit = screen.getByTestId("login-link-accept");
  expect(submit.closest("form")).toBeTruthy();
  fireEvent.click(submit);
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect(screen.getByRole("link", { name: "Check by signing in" })).toBeTruthy();
});

it("names the selected business account before asking staff to continue", () => {
  render(<ClubChoice choices={[{ tenantId: "a", name: "Worli Aquatics", roleName: "Coach" }]} />);
  fireEvent.click(screen.getByRole("radio", { name: /Worli Aquatics/ }));
  expect(screen.getByRole("status").textContent).toMatch(/Worli Aquatics/);
});

it("provides readable live confirmation on a previously checked-in QR visit", () => {
  render(<PremisesCheckInButton alreadyCheckedIn />);
  expect(screen.getByRole("status").textContent).toMatch(/checked in for today/i);
});

it.each([["member", "Member invitation", "/member/sign-in"], ["guardian", "Family invitation", "/family/sign-in"]] as const)(
  "identifies a missing %s invitation with the correct alternative sign-in",
  async (audience, heading, path) => {
    render(<SelfInvitationForm audience={audience} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in with your PIN instead" }).getAttribute("href")).toBe(path);
  },
);
