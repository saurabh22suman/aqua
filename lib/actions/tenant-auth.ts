"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";

// K2 — tenant-side sign-out.
//
// Mirror of logoutPlatformAction (lib/actions/platform-auth.ts). The
// platform surface had its own sign-out form in (platform)/layout.tsx;
// the tenant surfaces never got one, so owner/coach/reception could
// only end a session by clearing cookies in the browser. This calls
// better-auth's server-side signOut against the current request's
// headers so the session row is invalidated server-side too, not just
// the cookie cleared locally.
//
// The platform wrap around better-auth is load-bearing per db/scope.ts
// §"nesting" — withPlatform nests freely with itself and with the
// tenant scopes, but better-auth's request handlers also open their
// own platform-scoped queries; the wrap here keeps both sides happy
// without forcing one side or the other to know about the other.
//
// On success, redirects to /login. The redirect is thrown, never
// returned — the action never resolves to a typed result, by design:
// a successful sign-out cannot "fail" in a way the user should see.
export async function logoutTenantAction(): Promise<void> {
  const h = await headers();
  await withPlatform(() => auth.api.signOut({ headers: h }));
  redirect("/login");
}
