"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { FACILITY_COOKIE } from "@/lib/facility";
import { THEME_COOKIE } from "@/lib/theme/storage";

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
// The personal appearance preference (`aqua_theme`, lib/theme/storage.ts)
// goes with the session: it is a device-scoped cookie that outlived the
// account, so the next person to sign in on a shared device inherited
// the previous account's palette. Clearing it here — after the session
// really ended — covers the no-JavaScript form path too, where the
// browser posts the form to this action and the client never runs.
//
// On success, redirects to /login. The redirect is thrown, never
// returned — the action never resolves to a typed result, by design:
// a successful sign-out cannot "fail" in a way the user should see.
export async function logoutTenantAction(): Promise<void> {
  const h = await headers();
  await withPlatform(() => auth.api.signOut({ headers: h }));
  // Only the preferences that belong to the signed-in person are
  // cleared: the appearance preset (lib/theme/storage.ts) and the
  // facility scope choice (lib/facility.ts). The session cookie belongs
  // to better-auth, and nothing else on the device is ours to touch.
  const store = await cookies();
  store.delete(THEME_COOKIE);
  store.delete(FACILITY_COOKIE);
  redirect("/login");
}
