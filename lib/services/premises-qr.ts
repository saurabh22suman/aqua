import { createHmac, timingSafeEqual } from "node:crypto";

// V-25 — premises QR check-in token.
//
// A printed QR at the premises encodes `/check-in/<token>`. The token
// is an HS256 JWT-shaped signed claim naming the tenant and the
// purpose; it is PUBLIC by design (it hangs on a wall), so it is not
// an authentication credential — the scanning staff member's session
// is. The token exists to bind the poster to one tenant, to make the
// QR rotatable (mint a new token, the old poster stops verifying once
// its TTL lapses) and to give the check-in route something that
// distinguishes "this academy's poster" from any arbitrary URL.
//
// Geofence is deliberately deferred (the task calls it optional): a
// static QR can be photographed and used off-premises. The PR flags
// that limitation; the fix is a geofence or a rotating in-app code,
// not a longer token.
//
// Secret: PREMISES_QR_SECRET when set; otherwise derived from
// PARENT_LINK_SECRET with a purpose label (domain separation), so
// this feature needs no new production-required env var. Rotating
// PARENT_LINK_SECRET rotates the posters too — acceptable for a
// 180-day public token, and documented in .env.example.

export type PremisesQrScope = "premises_check_in";

export type PremisesQrClaims = {
  tenantId: string;
  scope: PremisesQrScope;
  iat: number;
  exp: number;
  jti: string;
};

const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60;

function baseSecret(): string {
  const dedicated = process.env.PREMISES_QR_SECRET;
  if (dedicated) return dedicated;
  const parent = process.env.PARENT_LINK_SECRET;
  if (parent) return parent;
  const dbUrl = process.env.DATABASE_URL ?? "dev-fallback";
  return `parent-link-dev-only-${dbUrl.slice(-12)}`;
}

function getSecret(): string {
  return createHmac("sha256", baseSecret())
    .update("aqua:premises-check-in:v1")
    .digest("hex");
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

export function signPremisesQrToken(args: {
  tenantId: string;
  ttlSeconds?: number;
}): { token: string; claims: PremisesQrClaims } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const claims: PremisesQrClaims = {
    tenantId: args.tenantId,
    scope: "premises_check_in",
    iat: now,
    exp: now + ttl,
    jti: `${now}-${Math.random().toString(36).slice(2, 10)}`,
  };
  const headerB64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = hmacSha256(getSecret(), signingInput);
  return { token: `${signingInput}.${b64url(sig)}`, claims };
}

// Malformed, tampered or expired tokens return null, never throw —
// the route renders a generic "this QR is not valid" state. Throwing
// on shape errors would leak the difference between wrong shape and
// wrong signature to a probing caller.
export function verifyPremisesQrToken(token: string): PremisesQrClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerBuf = b64urlDecode(headerB64);
  const payloadBuf = b64urlDecode(payloadB64);
  const sigBuf = b64urlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) return null;

  let header: { alg?: string };
  let payload: Partial<PremisesQrClaims>;
  try {
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = hmacSha256(getSecret(), `${headerB64}.${payloadB64}`);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(sigBuf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (typeof payload.tenantId !== "string") return null;
  if (payload.scope !== "premises_check_in") return null;
  if (typeof payload.exp !== "number") return null;
  if (typeof payload.iat !== "number") return null;
  if (typeof payload.jti !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (payload.iat > now + 60) return null;

  return {
    tenantId: payload.tenantId,
    scope: "premises_check_in",
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}
