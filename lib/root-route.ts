import { isOpsHost } from "@/lib/ops-host";
import { isServedBySurface } from "@/lib/surface-paths";
import type { SessionResolution } from "@/db/platform";

// Where the bare domain goes.
//
// The tenant surface and the platform surface are two different apps
// behind two sibling hosts (aqua.preprabbit.in and
// aquaops.preprabbit.in). Typing the bare domain must open the RIGHT
// one — the platform host must not land on a tenant page and the
// tenant host must not land on /ops.
//
// The decision is pure and lives here so it can be unit-tested
// without a request, a session or a database. The page (app/page.tsx)
// supplies the two inputs it needs — the Host header and the session
// resolution — and this module turns them into the destination path.
//
// Both destinations are same-host by construction: the caller
// redirects to a PATH, and the browser stays on the host it asked
// for. That is what keeps the host boundary intact — the tenant apex
// can never be sent to /ops, because the ops destination is only
// chosen for a host that IS the ops host.

/** The tenant door. Where the bare domain lands when nobody is signed in. */
export const TENANT_ROOT = "/login";

/** The platform door. The ops overview, which gates itself on the platform session. */
export const OPS_ROOT = "/ops";

/**
 * The destination for a request to the bare domain.
 *
 * - The platform host opens the platform app. `/ops` decides for
 *   itself whether to show the overview (signed in) or the platform
 *   sign-in (signed out) — that gate lives in the ops page and its
 *   layout, not here, so there is exactly one of them.
 * - The tenant host opens the signed-in user's own home (owner,
 *   coach, reception, worker, parent — wherever their role lands)
 *   and the sign-in screen when there is no session yet.
 *
 * A session that exists but resolves to nothing usable ('none' — no
 * active membership) or to a blocked tenant ('suspended') goes to the
 * sign-in door: the login form is where those two cases explain
 * themselves, exactly as they do after a failed sign-in.
 *
 * The role's home path is only used when the apex ACTUALLY SERVES it.
 * A role's home_path is tenant-customisable, so it could name a path
 * the apex does not serve — and the visitor would land on a 404
 * instead of their app. In that case the sign-in door is the honest
 * answer: it is a path the apex always serves, and it explains what
 * is wrong. (It also keeps the tenant apex from ever being pointed at
 * a platform path.)
 */
export function rootDestinationFor(
  host: string | null | undefined,
  session: SessionResolution,
): string {
  if (isOpsHost(host)) return OPS_ROOT;
  if (session.kind === "ok" && isServedBySurface(session.path, "apex")) {
    return session.path;
  }
  return TENANT_ROOT;
}
