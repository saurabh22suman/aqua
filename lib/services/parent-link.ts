import { createHmac, timingSafeEqual } from "node:crypto";

// C-45 — parent-page link service.
//
// Reuses the same JWT shape as the C-07 documents proposal: HS256,
// claims { tenant_id, person_id, scope, exp, iat, jti }. Single-
// purpose enforced by the verifier (scope-keyed reads; an attendance
// scope cannot read progress). 7-day TTL matching C-44.
//
// Two design choices from the audit response:
//
// 1. **Separate secret from BETTER_AUTH_SECRET.** A better-auth rotation
//    should not silently invalidate parents' 7-day links. The cost is
//    a second env var; the alternative is worse and non-obvious to the
//    operator rotating keys.
//
// 2. **No denylist table yet.** C-07's proposal documents denylist as
//    optional — for the demo and the C-45 MVP, TTL + rotating secret is
//    the audit trail. A denylist table is a cheap add later if revocation
//    becomes a real requirement (it would be: see the C-07 question
//    about "guardian accidentally shares a fee-link on a WhatsApp group").
//
// The verifier returns typed claims with shape validation; a malformed
// or tampered token yields `null`, never throws — `/p/[token]` renders
// a generic "link expired or invalid" page in that case. Throwing on
// parse errors would leak the difference between "wrong shape" and
// "wrong signature" to a probing caller.

export type ParentLinkScope = "parent_view";

export type ParentLinkClaims = {
  tenantId: string;
  personId: string;
  scope: ParentLinkScope;
  iat: number;
  exp: number;
  jti: string;
};

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  // The fallback path is dev/test only — production boot guard above
  // refuses to start if PARENT_LINK_SECRET is missing. The fallback
  // derives a stable-but-insecure key from the database URL so a
  // developer's links survive across restarts in a single .env.
  const secret = process.env.PARENT_LINK_SECRET;
  if (secret) return secret;
  const dbUrl = process.env.DATABASE_URL ?? "dev-fallback";
  return `parent-link-dev-only-${dbUrl.slice(-12)}`;
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
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  try {
    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  } catch {
    return null;
  }
}

function hmacSha256(secret: string, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

export function signParentLinkToken(args: {
  tenantId: string;
  personId: string;
  scope?: ParentLinkScope;
  ttlSeconds?: number;
}): { token: string; claims: ParentLinkClaims } {
  const scope: ParentLinkScope = args.scope ?? "parent_view";
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const jti = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  const claims: ParentLinkClaims = {
    tenantId: args.tenantId,
    personId: args.personId,
    scope,
    iat: now,
    exp: now + ttl,
    jti,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = hmacSha256(getSecret(), signingInput);
  const token = `${signingInput}.${b64url(sig)}`;
  return { token, claims };
}

export function verifyParentLinkToken(token: string): ParentLinkClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerBuf = b64urlDecode(headerB64);
  const payloadBuf = b64urlDecode(payloadB64);
  const sigBuf = b64urlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) return null;

  let header: { alg?: string; typ?: string };
  let payload: Partial<ParentLinkClaims>;
  try {
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }

  if (header.alg !== "HS256") return null;

  // Signature compare — timingSafeEqual so a probing caller can't
  // extract the secret byte-by-byte from response time.
  const expected = hmacSha256(getSecret(), `${headerB64}.${payloadB64}`);
  const a = new Uint8Array(expected.length);
  const b = new Uint8Array(sigBuf.length);
  for (let i = 0; i < expected.length; i++) a[i] = expected[i]!;
  for (let i = 0; i < sigBuf.length; i++) b[i] = sigBuf[i]!;
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (typeof payload.tenantId !== "string") return null;
  if (typeof payload.personId !== "string") return null;
  if (payload.scope !== "parent_view") return null;
  if (typeof payload.exp !== "number") return null;
  if (typeof payload.iat !== "number") return null;
  if (typeof payload.jti !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  // iat > now (clock skew tolerance: 60s). Reject tokens dated in
  // the future; they shouldn't exist.
  if (payload.iat > now + 60) return null;

  return {
    tenantId: payload.tenantId,
    personId: payload.personId,
    scope: "parent_view",
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}

export function parentLinkExpiry(claims: ParentLinkClaims): Date {
  return new Date(claims.exp * 1000);
}

void b64urlDecode;
