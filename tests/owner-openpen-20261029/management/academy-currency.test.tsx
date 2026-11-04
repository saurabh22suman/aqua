// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Academy profile — currency is INR-only presentation.
//
// Aqua stores and formats money in INR (docs/project-scope.md), and the
// shared formatter is INR-only. The form must not suggest arbitrary ISO-4217
// editing. The actual stored value stays visible; a non-INR stored value is
// explained as unsupported and is never rewritten by saving another field.

const updateTenantProfileAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/tenant-profile", () => ({
  updateTenantProfileAction,
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { AcademyProfileForm } from "@/components/settings/academy-profile-form";

afterEach(() => {
  cleanup();
  updateTenantProfileAction.mockReset();
});

const BASE = {
  name: "Splash Sports Club",
  currency: "INR",
  timezone: "Asia/Kolkata",
  gstin: "27AAAAA0000A1Z5",
};

describe("academy currency presentation", () => {
  it("shows INR read-only with INR-only support text", () => {
    render(<AcademyProfileForm initial={BASE} />);

    expect(screen.getByText("INR")).toBeTruthy();
    expect(screen.queryByLabelText(/Currency/)).toBeNull();
    expect(screen.getByText(/records money in INR/i)).toBeTruthy();
    expect(screen.queryByText(/ISO 4217/i)).toBeNull();
    expect(screen.getByText("India Standard Time (IST)")).toBeTruthy();
    expect(screen.getByText(/shown in IST/i)).toBeTruthy();
  });

  it("preserves the stored currency in the payload when another field is saved", async () => {
    updateTenantProfileAction.mockResolvedValue({ kind: "ok" });
    render(<AcademyProfileForm initial={BASE} />);

    fireEvent.change(screen.getByLabelText("Academy name"), {
      target: { value: "Splash Sports Club Worli" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save academy profile/i }));

    await waitFor(() =>
      expect(updateTenantProfileAction).toHaveBeenCalledWith({
        name: "Splash Sports Club Worli",
        timezone: "Asia/Kolkata",
        gstin: "27AAAAA0000A1Z5",
      }),
    );
    expect(updateTenantProfileAction.mock.calls[0]?.[0]).not.toHaveProperty(
      "currency",
    );
    expect(updateTenantProfileAction.mock.calls[0]?.[0]).not.toHaveProperty(
      "currency",
    );

    // A non-INR stored value is visible and explained, but saving the
    // profile is unavailable until the platform reviews the currency. The
    // backend rejects non-INR, so the UI must not attempt a doomed save.
    cleanup();
    updateTenantProfileAction.mockReset();
    updateTenantProfileAction.mockResolvedValue({ kind: "ok" });
    render(
      <AcademyProfileForm
        initial={{ ...BASE, currency: "USD", name: "Splash Sports Club" }}
      />,
    );
    expect(screen.getByText("USD")).toBeTruthy();
    expect(screen.queryByLabelText(/Currency/)).toBeNull();
    expect(
      screen.getByText(/stored currency .*USD.* not supported/i),
    ).toBeTruthy();
    // Other edits stay available: the payload simply omits currency, so the
    // backend preserves the stored USD and no INR coercion happens.
    const save = screen.getByRole("button", {
      name: /save academy profile/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Academy name"), {
      target: { value: "Splash Sports Club Worli" },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(updateTenantProfileAction).toHaveBeenCalledWith({
        name: "Splash Sports Club Worli",
        timezone: "Asia/Kolkata",
        gstin: "27AAAAA0000A1Z5",
      }),
    );
    expect(updateTenantProfileAction.mock.calls[0]?.[0]).not.toHaveProperty(
      "currency",
    );
    expect(screen.getByText("USD")).toBeTruthy();

    // A legacy time zone stays visible, flagged for review, and is preserved
    // in the payload — never silently replaced with IST.
    cleanup();
    updateTenantProfileAction.mockReset();
    updateTenantProfileAction.mockResolvedValue({ kind: "ok" });
    render(
      <AcademyProfileForm initial={{ ...BASE, timezone: "Europe/London" }} />,
    );
    expect(screen.getByText(/Stored value: Europe\/London/)).toBeTruthy();
    expect(
      screen.getByText(/not the India time zone.*kept exactly as recorded/i),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Academy name"), {
      target: { value: "Splash Sports Club Worli" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /save academy profile/i }),
    );
    await waitFor(() =>
      expect(updateTenantProfileAction).toHaveBeenCalledWith({
        name: "Splash Sports Club Worli",
        timezone: "Europe/London",
        gstin: "27AAAAA0000A1Z5",
      }),
    );
  });
});
