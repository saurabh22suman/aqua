import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// The paid-booking entry pass.
//
// A pass is a signed claim naming ONE booking in ONE tenant. It is an ENTRY
// artefact — not an authentication credential and not a payment instrument.
// The scanning staff member's session is the credential; the money is
// collected by hand at the counter. "One entry per booking" is enforced by
// the RECORDED ENTRY (booking_check_ins), not by the pass, so the pass itself
// can stay stateless.
//
// Shape: an HS256 JWT-shaped token, the same shape as the premises QR
// (lib/services/premises-qr.ts), so the codebase has one mental model for
// "a signed thing you can hold in your hand".
//
// SECRET POLICY (2026-11-06 security correction; the build-phase exemption
// removed 2026-11-08 — see the note on isProductionServing() below):
//   Precedence:
//     1. BOOKING_ENTRY_QR_SECRET when set and non-blank;
//     2. otherwise PARENT_LINK_SECRET, domain-separated by the purpose label
//        below;
//     3. otherwise a fixed development-only constant, ONLY in an explicitly
//        non-production process (NODE_ENV=development or test).
//
//   There is NO fallback derived from DATABASE_URL. A connection string is
//   not a signing secret, its tail is guessable or leakable, and deriving a
//   key from it would let anyone who learns one fragment forge an entry pass.
//
//   In every OTHER process a configured key is mandatory and must be at least
//   MIN_PRODUCTION_SECRET_CHARS characters. That includes a process running a
//   Next production BUILD: a build never signs or verifies an entry pass —
//   the mint and the scan are Server Actions — so a build never needs the
//   developer fallback. Missing, blank, malformed or weak keys FAIL CLOSED:
//     * signing throws, so no pass is minted;
//     * verification returns null, so no pass is admitted.
//   An unset or unknown NODE_ENV is treated as production. Only an explicit
//   development/test NODE_ENV licenses the developer fallback. This is
//   deliberately stricter than lib/env.ts's default-to-development rule,
//   because this is a signing boundary.
//
//   This feature still needs no new production-required env var:
//   PARENT_LINK_SECRET is already required at boot by lib/env.ts (except the
//   Next build phase). BOOKING_ENTRY_QR_SECRET is an optional dedicated key
//   for rotating entry passes independently of parent links.
//
//   ROTATION: changing BOOKING_ENTRY_QR_SECRET or PARENT_LINK_SECRET
//   invalidates outstanding passes immediately. There is no multi-key grace
//   window. A pass expires at the booking end, which is why that
//   trade is acceptable, and it is the same trade the premises QR already
//   makes.
//
// SECRET-SAFE DELIVERY:
//   * the secret is NEVER placed in the token, its payload or an audit row;
//   * the token is returned only to the authorised caller that minted it;
//   * malformed, tampered, wrong-scope and expired tokens return null, never
//     throw — a throw would leak the difference between shape errors and a
//     bad signature to a probing caller;
//   * a missing or weak production key also returns null from verification,
//     for the same reason: an operator misconfiguration must not become a
//     signed pass;
//   * the payload carries only tenantId, bookingId, scope, iat, exp and jti.
//     No member name, phone, email or money value is in it.

export type BookingEntryScope = "booking_entry";

export type BookingEntryClaims = {
  tenantId: string;
  bookingId: string;
  scope: BookingEntryScope;
  iat: number;
  exp: number;
  jti: string;
};

export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

const PURPOSE_LABEL = "aqua:booking-entry:v1";
const MIN_PRODUCTION_SECRET_CHARS = 32;
const DEV_ONLY_FALLBACK = "aqua-booking-entry-dev-only-not-for-production";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SecretSource = "BOOKING_ENTRY_QR_SECRET" | "PARENT_LINK_SECRET";

function requireNonBlank(value: string, name: SecretSource): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `${name} is set but empty/whitespace-only; unset it or provide a strong signing secret.`,
    );
  }
  return trimmed;
}

function configuredSecret(): { source: SecretSource; value: string } | null {
  const dedicated = process.env.BOOKING_ENTRY_QR_SECRET;
  if (dedicated !== undefined) {
    return {
      source: "BOOKING_ENTRY_QR_SECRET",
      value: requireNonBlank(dedicated, "BOOKING_ENTRY_QR_SECRET"),
    };
  }
  const parent = process.env.PARENT_LINK_SECRET;
  if (parent !== undefined) {
    return {
      source: "PARENT_LINK_SECRET",
      value: requireNonBlank(parent, "PARENT_LINK_SECRET"),
    };
  }
  return null;
}

function isExplicitNonProduction(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

function isProductionServing(): boolean {
  // Fail closed on an unset or unknown NODE_ENV. Only an explicit
  // development/test value opts into the developer fallback.
  //
  // There is deliberately NO build-phase exemption here. `next build` does
  // not mint or verify an entry pass — the mint and the scan are Server
  // Actions, so they run only when a request arrives — so a build never
  // needs the developer fallback. lib/env.ts's build-phase exemption is a
  // BOOT rule: the build must be able to boot without production secrets.
  // It is not a signing rule.
  //
  // NEXT_PHASE is an ordinary, operator-settable environment variable: it is
  // not in the schema, not validated and not documented for operators. If a
  // leftover build marker can relax the signer, then a served process can
  // sign — and verify — with the repository-public development constant, a
  // key every reader of this repository already has. The exemption therefore
  // lives only at the boot, where it is needed, and never at the signing
  // boundary.
  return !isExplicitNonProduction();
}

function assertProductionStrength(secret: {
  source: SecretSource;
  value: string;
}): void {
  if (secret.value.length < MIN_PRODUCTION_SECRET_CHARS) {
    throw new Error(
      `${secret.source} is too short for production: use at least ` +
        `${MIN_PRODUCTION_SECRET_CHARS} characters from a cryptographically ` +
        `random source. Refusing to sign or verify booking-entry passes with ` +
        `a weak key.`,
    );
  }
}

function baseSecret(): string {
  const configured = configuredSecret();
  if (isProductionServing()) {
    if (!configured) {
      throw new Error(
        "No booking-entry QR signing secret is configured for production. " +
          "Set BOOKING_ENTRY_QR_SECRET (preferred) or PARENT_LINK_SECRET. " +
          "Refusing to sign or verify entry passes with a fallback key.",
      );
    }
    assertProductionStrength(configured);
    return configured.value;
  }
  // Explicitly non-production. This fallback is fixed and clearly labelled;
  // it is NEVER derived from DATABASE_URL.
  return configured?.value ?? DEV_ONLY_FALLBACK;
}

function getSecret(): string {
  return createHmac("sha256", baseSecret())
    .update(PURPOSE_LABEL)
    .digest("hex");
}

function getSecretOrNull(): string | null {
  try {
    return getSecret();
  } catch {
    // Verification must never throw: a missing/weak production key and an
    // invalid pass look the same to the caller, and both admit nobody.
    return null;
  }
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  try {
    const decoded = Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
    return b64url(decoded) === input ? decoded : null;
  } catch {
    return null;
  }
}

function hmacSha256(secret: string, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

export function signBookingEntryToken(args: {
  tenantId: string;
  bookingId: string;
  ttlSeconds?: number;
}): { token: string; claims: BookingEntryClaims } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const claims: BookingEntryClaims = {
    tenantId: args.tenantId,
    bookingId: args.bookingId,
    scope: "booking_entry",
    iat: now,
    exp: now + ttl,
    // jti is a correlation id, not a credential. randomUUID is deliberate:
    // Math.random() is not suitable for anything that appears in a signed
    // payload, even a non-security identifier.
    jti: randomUUID(),
  };
  const headerB64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = hmacSha256(getSecret(), signingInput);
  return { token: `${signingInput}.${b64url(sig)}`, claims };
}

/**
 * Verify a pass. Returns null for anything that is not a current, correctly
 * signed, in-scope token for this tenant's shape. The caller decides whether
 * the claim's tenant/booking are visible to the actor; this function only
 * proves the token itself.
 */
export function verifyBookingEntryToken(
  token: string,
): BookingEntryClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerBuf = b64urlDecode(headerB64);
  const payloadBuf = b64urlDecode(payloadB64);
  const sigBuf = b64urlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) return null;

  let header: { alg?: string };
  let payload: Partial<BookingEntryClaims>;
  try {
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || Array.isArray(header) || header.alg !== "HS256") return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const secret = getSecretOrNull();
  if (!secret) return null;

  const expected = hmacSha256(secret, `${headerB64}.${payloadB64}`);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(sigBuf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (typeof payload.tenantId !== "string") return null;
  if (!UUID_RE.test(payload.tenantId)) return null;
  if (typeof payload.bookingId !== "string") return null;
  if (!UUID_RE.test(payload.bookingId)) return null;
  if (payload.scope !== "booking_entry") return null;
  if (typeof payload.exp !== "number") return null;
  if (typeof payload.iat !== "number") return null;
  if (typeof payload.jti !== "string" || payload.jti.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  if (payload.iat > now + 60) return null;

  return {
    tenantId: payload.tenantId,
    bookingId: payload.bookingId,
    scope: "booking_entry",
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}
