import { describe, expect, it, vi } from "vitest";

// UI foundation — the server side of the sign-out clears the personal
// appearance preference.
//
// The preset cookie (`aqua_theme`) is device-scoped and lives a year
// (lib/theme/storage.ts). Until this change nothing removed it on
// sign-out, so a shared device handed the next account the previous
// account's palette. The sign-out is the one moment where the account
// is known to be ending, so the preference goes with it.
//
// The server action is the authoritative place: it also covers the
// no-JavaScript form path, where the browser posts the form to the
// action and the client never runs.
//
// RED status at the time of writing: logoutTenantAction() only called
// better-auth's signOut — no cookie was touched, and the theme cookie
// survived the session.

const { cookieStore, signOut, redirectSpy } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  signOut: vi.fn(async () => ({ success: true })),
  redirectSpy: vi.fn((path: string) => {
    const error = new Error(`NEXT_REDIRECT:${path}`) as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${path}`;
    throw error;
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectSpy(path),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { signOut: (...args: unknown[]) => signOut(...(args as [])) } },
}));

vi.mock("@/db/scope", () => ({
  withPlatform: async (fn: () => unknown) => fn(),
}));

import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { FACILITY_COOKIE } from "@/lib/facility";
import { THEME_COOKIE } from "@/lib/theme/storage";

describe("sign-out clears the personal appearance preference", () => {
  it("removes the preset cookie when the session ends", async () => {
    cookieStore.set(THEME_COOKIE, "lavender");
    await expect(logoutTenantAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(cookieStore.has(THEME_COOKIE)).toBe(false);
  });

  it("still ends the session and redirects — the change is additive", async () => {
    cookieStore.set(THEME_COOKIE, "mint");
    signOut.mockClear();
    redirectSpy.mockClear();

    await expect(logoutTenantAction()).rejects.toThrow(/NEXT_REDIRECT/);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith("/login");
  });

  it("clears the account's own display preferences and nothing else", async () => {
    cookieStore.clear();
    cookieStore.set(THEME_COOKIE, "lavender");
    cookieStore.set(FACILITY_COOKIE, "3f1b0c2a-0000-4000-8000-000000000001");
    cookieStore.set("better-auth.session_token", "session-value");

    await expect(logoutTenantAction()).rejects.toThrow(/NEXT_REDIRECT/);

    // The two preferences that belong to the signed-in person are gone:
    // the appearance preset and the facility scope choice.
    expect(cookieStore.has(THEME_COOKIE)).toBe(false);
    expect(cookieStore.has(FACILITY_COOKIE)).toBe(false);
    // Nothing else is touched — the session cookie belongs to better-auth.
    expect(cookieStore.get("better-auth.session_token")).toBe("session-value");
  });
});
