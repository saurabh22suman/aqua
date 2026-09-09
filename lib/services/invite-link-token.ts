import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";

// Invite-link token codec. Token shape mirrors
// lib/services/parent-link.ts (HS256, { tenantId, membershipId,
// purpose, iat, exp, jti }) but is NOT interchangeable with it:
// the verifier rejects anything without a membershipId + invite
// purpose, so a parent token can never redeem as a login and vice
// versa. HMAC key is domain-separated from the parent-link key
// for the same reason.

export const INVITE_LINK_TTL_SECONDS = 72 * 60 * 60;
export const RELOGIN_LINK_TTL_SECONDS = 24 * 60 * 60;

export type InviteLinkClaims = {
  tenantId: string;
  membershipId: string;
  purpose: InviteLinkPurpose;
  iat: number;
  exp: number;
  jti: string;
};

function getSecret(): string {
  // Same env var as parent links (one fewer secret for the
  // operator to lose), domain-separated so the two token kinds
  // never verify under each other's key. Dev fallback mirrors
  // parent-link.ts; production boot refuses to start without
  // PARENT_LINK_SECRET either way.
  const base =
    process.env.PARENT_LINK_SECRET ??
    `parent-link-dev-only-${(process.env.DATABASE_URL ?? "dev-fallback").slice(-12)}`;
  return `${base}:invite-login-v1`;
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

export function signInviteLinkToken(args: {
  tenantId: string;
  membershipId: string;
  purpose: InviteLinkPurpose;
  ttlSeconds?: number;
}): { token: string; claims: InviteLinkClaims } {
  const now = Math.floor(Date.now() / 1000);
  const claims: InviteLinkClaims = {
    tenantId: args.tenantId,
    membershipId: args.membershipId,
    purpose: args.purpose,
    iat: now,
    exp: now + (args.ttlSeconds ?? INVITE_LINK_TTL_SECONDS),
    jti: randomUUID(),
  };
  const headerB64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", getSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  return { token: `${headerB64}.${payloadB64}.${b64url(sig)}`, claims };
}

export function verifyInviteLinkToken(token: string): InviteLinkClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerBuf = b64urlDecode(headerB64);
  const payloadBuf = b64urlDecode(payloadB64);
  const sigBuf = b64urlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) return null;

  let header: { alg?: string };
  let payload: Partial<InviteLinkClaims>;
  try {
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = createHmac("sha256", getSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const a = new Uint8Array(expected);
  const b = new Uint8Array(sigBuf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (typeof payload.tenantId !== "string") return null;
  if (typeof payload.membershipId !== "string") return null;
  if (payload.purpose !== "invite" && payload.purpose !== "relogin") return null;
  if (typeof payload.exp !== "number") return null;
  if (typeof payload.iat !== "number") return null;
  if (typeof payload.jti !== "string" || payload.jti.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (payload.iat > now + 60) return null;

  return {
    tenantId: payload.tenantId,
    membershipId: payload.membershipId,
    purpose: payload.purpose,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}
