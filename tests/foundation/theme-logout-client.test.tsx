// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// UI foundation — the browser side of the sign-out clears the personal
// appearance preference.
//
// The server action clears the cookie for the no-JavaScript path, but
// the browser keeps its own copy until the response lands — and the
// sign-out redirects, so the client code after the action may never
// run. The client therefore clears the preference as part of the
// sign-out intent, before the server call.
//
// The one case that must NOT clear it: the sign-out is deferred because
// unsynced attendance is waiting (the user is told to retry, or to stay
// signed in). The account has not ended, so the preference stays.
//
// RED status at the time of writing: nothing cleared the cookie, so the
// next account on the device inherited the previous account's palette.

const { syncBeforeLogout, logoutTenantAction } = vi.hoisted(() => ({
  syncBeforeLogout: vi.fn(async () => 0),
  logoutTenantAction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/actions/tenant-auth", () => ({
  logoutTenantAction: (...args: unknown[]) =>
    logoutTenantAction(...(args as [])),
}));

vi.mock("@/lib/offline/logout", () => ({
  syncBeforeLogout: (...args: unknown[]) => syncBeforeLogout(...(args as [])),
}));

vi.mock("@/lib/offline/client-session", () => ({
  clearOfflineData: vi.fn(async () => {}),
  runOfflineLifecycle: async (fn: () => unknown) => fn(),
}));

import { TenantSignOut } from "@/components/tenant-sign-out";
import { FACILITY_COOKIE } from "@/lib/facility";
import { THEME_COOKIE } from "@/lib/theme/storage";

function setPresetCookie(value: string): void {
  document.cookie = `${THEME_COOKIE}=${value}; path=/`;
}

function setFacilityCookie(value: string): void {
  document.cookie = `${FACILITY_COOKIE}=${value}; path=/`;
}

function readCookie(name: string): string | undefined {
  const row = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return row?.slice(name.length + 1);
}

function readPresetCookie(): string | undefined {
  return readCookie(THEME_COOKIE);
}

afterEach(() => {
  cleanup();
  syncBeforeLogout.mockReset();
  syncBeforeLogout.mockResolvedValue(0);
  logoutTenantAction.mockReset();
  logoutTenantAction.mockResolvedValue(undefined);
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${FACILITY_COOKIE}=; path=/; max-age=0`;
});

describe("sign out clears the personal appearance preference", () => {
  it("removes the preset cookie when the user signs out", async () => {
    setPresetCookie("lavender");
    expect(readPresetCookie()).toBe("lavender");

    render(<TenantSignOut />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(logoutTenantAction).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(readPresetCookie()).toBeUndefined();
    });
  });

  it("removes the facility scope choice when the user signs out", async () => {
    setFacilityCookie("3f1b0c2a-0000-4000-8000-000000000001");

    render(<TenantSignOut />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(logoutTenantAction).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(readCookie(FACILITY_COOKIE)).toBeUndefined();
    });
  });

  it("keeps the preference when the sign-out is deferred for unsynced work", async () => {
    setPresetCookie("lavender");
    setFacilityCookie("3f1b0c2a-0000-4000-8000-000000000001");
    syncBeforeLogout.mockResolvedValue(2);

    render(<TenantSignOut />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(
        screen.getByText(/attendance marks? (is|are) saved on this device/i),
      ).toBeTruthy();
    });
    // The account did not end: no sign-out call, and the preferences stay.
    expect(logoutTenantAction).not.toHaveBeenCalled();
    expect(readPresetCookie()).toBe("lavender");
    expect(readCookie(FACILITY_COOKIE)).toBe("3f1b0c2a-0000-4000-8000-000000000001");
  });
});
