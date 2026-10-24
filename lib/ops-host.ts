// Which host serves the platform (ops) surface.
//
// The platform surface used to live at `ops.<base>` — a subdomain of
// the tenant apex — and the middleware recognised it by the `ops.`
// prefix alone, with no configuration. That shape no longer holds:
// the tenant surface is `aqua.preprabbit.in` and the platform
// surface is `aquaops.preprabbit.in`. That is a sibling host: it is
// NOT a subdomain of the apex and it does NOT carry the `ops.`
// prefix, so the prefix rule can no longer decide it.
//
// One module owns the decision so the routing layer and the auth
// routes cannot drift apart. Two call sites must agree on what "the
// ops host" is:
//   * middleware.ts — which host may serve which path prefix;
//   * lib/auth/whatsapp-route.ts — which sign-in flow a host may use.
// If they disagree, the platform surface either 404s on its own host
// or a tenant host gains /ops.
//
// Resolution order (see isOpsHost):
//   1. The configured OPS_HOST is the platform host.
//   2. Any host under an `ops.` label is ALSO the platform host. That
//      legacy shape is kept so local development (ops.localhost) and
//      any existing `ops.<base>` deployment keep working untouched —
//      it is additive, never narrowing what rule 1 already matched.
//
// Both rules answer the same question for one reason: the platform
// surface must never be reachable from the tenant apex, and the
// tenant apex must never gain /ops.
//
// Edge-safe on purpose: middleware.ts imports this module and the
// Edge runtime cannot load node:fs, so there is no dotenv loader
// here — process.env is read directly. The value is validated by
// lib/env.ts at boot (NODE_ENV=production refuses to start without a
// well-formed OPS_HOST), so the lenient parse below never sees a
// malformed value in a running process; it only keeps an
// unconfigured environment from throwing inside a request.

/** The environment variable that names the platform (ops) host. */
export const OPS_HOST_ENV = "OPS_HOST";

/**
 * A bare hostname: no scheme, no port, no path, no trailing dot.
 * Labels are 1-63 characters of letters, digits and hyphens, and may
 * not start or end with a hyphen.
 */
export const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Longest legal DNS name. */
const MAX_HOSTNAME_LENGTH = 253;

/**
 * The legacy platform-host shape: any host under an `ops.` label.
 * Only consulted when OPS_HOST is unset — see the module comment.
 */
const LEGACY_OPS_PREFIX = "ops.";

/** Lowercase a host and drop its port. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Parse an OPS_HOST value. Returns null when the value is absent or
 * not a bare hostname — a malformed value must never widen the
 * platform host's reach, so it is treated as "not configured" rather
 * than being coerced into something that matches.
 */
export function parseOpsHost(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return null;
  if (value.length > MAX_HOSTNAME_LENGTH) return null;
  if (!HOSTNAME_PATTERN.test(value)) return null;
  return value;
}

/** The configured platform host, or null when it is unset/invalid. */
export function opsHost(): string | null {
  return parseOpsHost(process.env.OPS_HOST);
}

/**
 * True when this request's Host belongs to the platform (ops)
 * surface. Both the tenant apex and the platform host answer on the
 * same server; this is the one place that tells them apart.
 */
export function isOpsHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalized = normalizeHost(host);
  if (normalized.length === 0) return false;
  const configured = opsHost();
  if (configured !== null && normalized === configured) return true;
  return normalized.startsWith(LEGACY_OPS_PREFIX);
}
