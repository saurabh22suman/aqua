import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SHOWCASE_LINK_SCOPE = "showcase_view";

export const SHOWCASE_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ShowcaseLinkClaims = {
  tenantId: string;
  publicationId: string;
  scope: typeof SHOWCASE_LINK_SCOPE;
  iat: number;
  exp: number;
  jti: string;
};

function getSecret(): string {
  const configured = process.env.PARENT_LINK_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 32)) {
    throw new Error("Showcase signing key is unavailable");
  }
  const base =
    process.env.PARENT_LINK_SECRET ??
    `parent-link-dev-only-${(process.env.DATABASE_URL ?? "dev-fallback").slice(-12)}`;
  return `${base}:showcase-view-v1`;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function signShowcaseLinkToken(args: {
  tenantId: string;
  publicationId: string;
  ttlSeconds?: number;
}): { token: string; claims: ShowcaseLinkClaims } {
  const ttl = args.ttlSeconds ?? SHOWCASE_LINK_TTL_SECONDS;
  if (!isFiniteInteger(ttl) || ttl <= 0) {
    throw new Error("signShowcaseLinkToken: the lifetime must be a positive integer");
  }
  const now = Math.floor(Date.now() / 1000);
  const claims: ShowcaseLinkClaims = {
    tenantId: args.tenantId,
    publicationId: args.publicationId,
    scope: SHOWCASE_LINK_SCOPE,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
  };
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = hmacSha256(getSecret(), signingInput);
  const token = `${signingInput}.${b64url(sig)}`;
  return { token, claims };
}

export function verifyShowcaseLinkToken(token: string): ShowcaseLinkClaims | null {
  try {
    if (typeof token !== "string" || token.length === 0) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    const headerBuf = b64urlDecode(headerB64);
    const payloadBuf = b64urlDecode(payloadB64);
    const sigBuf = b64urlDecode(sigB64);
    if (!headerBuf || !payloadBuf || !sigBuf) return null;

    let header: unknown;
    let payload: unknown;
    try {
      header = JSON.parse(headerBuf.toString("utf8"));
      payload = JSON.parse(payloadBuf.toString("utf8"));
    } catch {
      return null;
    }

    if (!isPlainObject(header)) return null;
    if (!isPlainObject(payload)) return null;

    if (header.alg !== "HS256") return null;

    const expected = hmacSha256(getSecret(), `${headerB64}.${payloadB64}`);
    const a = new Uint8Array(expected.length);
    const b = new Uint8Array(sigBuf.length);
    for (let i = 0; i < expected.length; i++) a[i] = expected[i]!;
    for (let i = 0; i < sigBuf.length; i++) b[i] = sigBuf[i]!;
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const tenantId = payload.tenantId;
    const publicationId = payload.publicationId;
    const scope = payload.scope;
    const iat = payload.iat;
    const exp = payload.exp;
    const jti = payload.jti;

    if (typeof tenantId !== "string") return null;
    if (typeof publicationId !== "string") return null;
    if (scope !== SHOWCASE_LINK_SCOPE) return null;
    if (!isFiniteInteger(iat)) return null;
    if (!isFiniteInteger(exp)) return null;
    if (typeof jti !== "string" || jti.length === 0) return null;

    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) return null;
    if (exp <= iat) return null;
    if (iat > now + 60) return null;

    return {
      tenantId,
      publicationId,
      scope: SHOWCASE_LINK_SCOPE,
      iat,
      exp,
      jti,
    };
  } catch {
    return null;
  }
}
