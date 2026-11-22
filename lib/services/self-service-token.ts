// POSTIMAGE — lib/services/self-service-token.ts  (candidate, NOT applied)
//
// The self-service ACTIVATION token.
//
// It is a DIFFERENT credential kind from the staff login token and is
// verified under a DIFFERENT key. That separation is load-bearing: a staff
// token can never verify here, and a self-service token can never verify
// under the staff codec. A self-service token therefore cannot be replayed
// into the staff redeem, and a staff token cannot be replayed into the
// self-service redeem -- whatever either token's claims say.
//
// The claims carry NO membership. A link-only principal has no
// tenant_memberships row, so the token binds the ACCOUNT and the LINKAGE
// ROWS instead.
//
// The token is one-time and is consumed by a unique-PK insert, the same way
// the staff link is (lib/services/invite-link.ts:254-264).
//
// The verifier returns null on any malformed or tampered input and never
// throws: a probe must not learn WHY (lib/services/parent-link.ts:102-154).
//
// The key is `${PARENT_LINK_SECRET}:self-service-activate-v1` -- the
// repository's domain-separation pattern. NO new environment variable and
// NO new production boot guard; PARENT_LINK_SECRET is already production-
// required (lib/env.ts).
//
// NO SMS AND NO OTP: this codec proves possession of the one-time link and
// nothing else. It never carries, requests or verifies a message code, and
// no surface may describe the number it binds as "verified" -- it is the
// club's record (verification_method = 'club_record').

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  selfServiceAudience,
  type SelfServiceAudience,
} from "@/db/schema/self-service-session";

// The self-service ACTIVATION token's lifetime. A SERVICE PARAMETER, not a
// schema fact: nothing about it is enforced by the database, and it is not
// approved by this file. The value is the reviewed packet's default
// (72 hours) and it is named as a residual in the handoff.
export const SELF_SERVICE_ACTIVATION_TTL_SECONDS = 72 * 60 * 60;

export type SelfServiceTokenClaims = {
  tenantId: string;
  userId: string;
  audience: SelfServiceAudience;
  subjectId: string | null;
  linkIds: string[];
  iat: number;
  exp: number;
  jti: string;
};

// The same bound the mint side enforces. A token naming more rows than this
// is refused rather than truncated.
const MAX_LINK_IDS = 64;

// A uuid, not an arbitrary string. withTenant REFUSES a non-uuid tenant id
// by throwing (db/tenant.ts:14-18), so a shape check here is what keeps a
// hand-signed token from turning into a 500 instead of a refusal.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSecret(): string {
  const secret = process.env.PARENT_LINK_SECRET;
  const base =
    secret ??
    `parent-link-dev-only-${(process.env.DATABASE_URL ?? "dev-fallback").slice(-12)}`;
  return `${base}:self-service-activate-v1`;
}

// b64url / b64urlDecode / hmacSha256 are copied EXACTLY from
// lib/services/parent-link.ts:53-73. They are module-private there, so they
// are copied rather than imported, and the shapes are identical.

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

function isSelfServiceAudience(value: string): value is SelfServiceAudience {
  return (selfServiceAudience as readonly string[]).includes(value);
}

export function signSelfServiceToken(args: {
  tenantId: string;
  userId: string;
  audience: SelfServiceAudience;
  subjectId: string | null;
  linkIds: string[];
  ttlSeconds?: number;
}): { token: string; claims: SelfServiceTokenClaims } {
  // A token with no linkage row would bind nothing: the session's own
  // ledger needs at least one binding row, and the activation could not
  // prove a subject. This is a programming error, not a runtime input, so
  // it throws.
  if (args.linkIds.length === 0) {
    throw new Error(
      "signSelfServiceToken: a self-service token must name at least one linkage row.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const claims: SelfServiceTokenClaims = {
    tenantId: args.tenantId,
    userId: args.userId,
    audience: args.audience,
    subjectId: args.subjectId,
    linkIds: [...args.linkIds].sort(),
    iat: now,
    exp: now + (args.ttlSeconds ?? SELF_SERVICE_ACTIVATION_TTL_SECONDS),
    jti: randomUUID(),
  };
  const headerB64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64url(JSON.stringify(claims));
  const sig = hmacSha256(getSecret(), `${headerB64}.${payloadB64}`);
  return { token: `${headerB64}.${payloadB64}.${b64url(sig)}`, claims };
}

/**
 * Verifies a self-service activation token.
 *
 * Returns null for ANY malformed, tampered, expired or wrongly-shaped token,
 * and never throws. The caller cannot tell which check failed.
 */
export function verifySelfServiceToken(
  token: string,
): SelfServiceTokenClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerBuf = b64urlDecode(headerB64);
  const payloadBuf = b64urlDecode(payloadB64);
  const sigBuf = b64urlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) return null;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(headerBuf.toString("utf8")) as Record<string, unknown>;
    payload = JSON.parse(payloadBuf.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (header.alg !== "HS256") return null;

  // Signature compare -- timingSafeEqual so a probing caller can't extract
  // the secret byte-by-byte from response time (the parent link's shape,
  // lib/services/parent-link.ts:125-131).
  const expected = hmacSha256(getSecret(), `${headerB64}.${payloadB64}`);
  const a = new Uint8Array(expected.length);
  const b = new Uint8Array(sigBuf.length);
  for (let i = 0; i < expected.length; i++) a[i] = expected[i]!;
  for (let i = 0; i < sigBuf.length; i++) b[i] = sigBuf[i]!;
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const tenantId = payload.tenantId;
  const userId = payload.userId;
  const audience = payload.audience;
  const subjectId = payload.subjectId;
  const rawLinkIds = payload.linkIds;
  const exp = payload.exp;
  const iat = payload.iat;
  const jti = payload.jti;

  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return null;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return null;
  if (typeof audience !== "string" || !isSelfServiceAudience(audience)) {
    return null;
  }

  // subjectId is a string IFF the audience is "member" -- the same rule the
  // session table's CHECK states (self_service_sessions_subject_check).
  let checkedSubjectId: string | null = null;
  if (audience === "member") {
    if (typeof subjectId !== "string" || !UUID_RE.test(subjectId)) return null;
    checkedSubjectId = subjectId;
  } else if (subjectId !== null && subjectId !== undefined) {
    return null;
  }

  if (!Array.isArray(rawLinkIds)) return null;
  const ids = rawLinkIds as unknown[];
  if (ids.length === 0 || ids.length > MAX_LINK_IDS) return null;
  const linkIds: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_RE.test(id)) return null;
    linkIds.push(id);
  }

  if (typeof exp !== "number") return null;
  if (typeof iat !== "number") return null;
  if (typeof jti !== "string" || jti.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return null;
  // iat in the future -- 60s of clock skew, the parent link's tolerance
  // (lib/services/parent-link.ts:144-145).
  if (iat > now + 60) return null;

  return {
    tenantId,
    userId,
    audience,
    subjectId: checkedSubjectId,
    linkIds,
    iat,
    exp,
    jti,
  };
}
