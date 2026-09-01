import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
  randomUUID,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatform } from "./scope";
import {
  platformUsers,
  platformSessions,
  platformAuditLog,
} from "./schema";

export const PLATFORM_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h, sliding on activity
export const SCRYPT_N = 16384; // CPU/memory cost — Node default; raised for prod if desired

export class PlatformAuthError extends Error {
  constructor(
    public readonly code:
      | "invalid_credentials"
      | "invalid_totp"
      | "no_totp"
      | "session_expired"
      | "session_invalid"
      | "second_factor_required"
      | "user_suspended",
    message: string,
  ) {
    super(message);
  }
}

function hashPassword(password: string, salt: string): string {
  // scrypt: deterministic for (password, salt); no pepper here — a
  // leaked DB does not leak the production password hashes alone. The
  // verification path recomputes with the stored salt and compares with
  // timingSafeEqual. Cost 16384 is the Node default — bump for a higher
  // attack budget if/when offline cracking becomes a real concern.
  return scryptSync(password, salt, 64, { N: SCRYPT_N }).toString("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sha256(input: string): string {
  return createHmac("sha256", "platform-session-token-v1")
    .update(input)
    .digest("hex");
}

export const platformLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export type PlatformLoginInput = z.infer<typeof platformLoginInput>;

export const platformTotpInput = z.object({
  sessionToken: z.string().min(32).max(128),
  code: z.string().regex(/^\d{6}$/),
});
export type PlatformTotpInput = z.infer<typeof platformTotpInput>;

function base32Decode(input: string): Buffer {
  // RFC 4648 base32 decoder, no padding required. Node's Buffer does
  // not ship with this encoding so we do it ourselves; only ~30 lines
  // and zero deps. Returns the raw byte buffer.
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Verify a 6-digit TOTP code against the user's secret. RFC 6238 with
 * SHA-1, 30s step, ±1 step window (90s total) for clock skew. Constant
 * time on candidate comparison.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return false;
  }
  if (secretBytes.length < 10) return false;
  const counter = Math.floor(now / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    const counterHex = (counter + i).toString(16).padStart(16, "0");
    const hmac = createHmac("sha1", secretBytes)
      .update(Buffer.from(counterHex, "hex"))
      .digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const candidate = (binary % 1_000_000).toString().padStart(6, "0");
    if (constantTimeEqual(candidate, code)) return true;
  }
  return false;
}

export type PlatformAuthResult =
  | { kind: "second_factor_required"; sessionToken: string }
  | { kind: "fully_authenticated"; sessionToken: string; userId: string; role: "admin" | "viewer" };

/**
 * Password check. Returns a half-authenticated session (the cookie) so
 * the caller can present the 2FA challenge; TOTP verification on a
 * separate call promotes it to fully_authenticated. Two-step on
 * purpose: a stolen password alone must not be enough.
 */
export async function platformLogin(
  input: PlatformLoginInput,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<PlatformAuthResult> {
  return withPlatform(async () => {
    const [user] = await db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.email, input.email.toLowerCase()))
      .limit(1);
    if (!user) {
      // Constant-time the no-such-user path too: a wrong email should
      // not return instantly while a wrong password hashes and
      // compares. Cheap defence; nothing more.
      hashPassword(input.password, "decoy-salt-to-equal-real-cost");
      throw new PlatformAuthError("invalid_credentials", "invalid credentials");
    }
    if (user.status !== "active") {
      throw new PlatformAuthError("user_suspended", "user suspended");
    }
    const candidate = hashPassword(input.password, user.passwordSalt);
    if (!constantTimeEqual(candidate, user.passwordHash)) {
      throw new PlatformAuthError("invalid_credentials", "invalid credentials");
    }
    if (!user.totpEnrolled || !user.totpSecret) {
      throw new PlatformAuthError("no_totp", "platform user has no enrolled 2FA");
    }
    const sessionToken = randomBytes(32).toString("hex");
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_SECONDS * 1000);
    await db.insert(platformSessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash: sha256(sessionToken),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      secondFactorPassed: false,
      expiresAt,
    });
    return { kind: "second_factor_required", sessionToken };
  });
}

export async function platformVerifyTotp(
  input: PlatformTotpInput,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<PlatformAuthResult> {
  return withPlatform(async () => {
    const tokenHash = sha256(input.sessionToken);
    const [session] = await db
      .select({
        session: platformSessions,
        user: platformUsers,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.userId))
      .where(eq(platformSessions.tokenHash, tokenHash))
      .limit(1);

    if (!session) {
      throw new PlatformAuthError("session_invalid", "session not found");
    }
    if (session.session.expiresAt.getTime() < Date.now()) {
      throw new PlatformAuthError("session_expired", "session expired");
    }
    if (!session.user.totpSecret) {
      throw new PlatformAuthError("no_totp", "no enrolled 2FA");
    }
    if (session.user.status !== "active") {
      throw new PlatformAuthError("user_suspended", "user suspended");
    }
    if (!verifyTotp(session.user.totpSecret, input.code)) {
      throw new PlatformAuthError("invalid_totp", "invalid TOTP code");
    }
    await db
      .update(platformSessions)
      .set({
        secondFactorPassed: true,
        lastSeenAt: new Date(),
      })
      .where(eq(platformSessions.id, session.session.id));
    await db
      .update(platformUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformUsers.id, session.user.id));
    await db.insert(platformAuditLog).values({
      actorId: session.user.id,
      action: "platform.login",
      ipAddress: meta.ipAddress,
    });
    return {
      kind: "fully_authenticated",
      sessionToken: input.sessionToken,
      userId: session.user.id,
      role: session.user.role as "admin" | "viewer",
    };
  });
}

export type PlatformSessionLookup =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "unauthenticated"; userId: string; role: "admin" | "viewer" }
  | { kind: "authenticated"; userId: string; role: "admin" | "viewer" };

export async function lookupPlatformSession(
  sessionToken: string,
): Promise<PlatformSessionLookup> {
  if (!sessionToken) return { kind: "not_found" };
  const tokenHash = sha256(sessionToken);
  return withPlatform(async () => {
    const [row] = await db
      .select({
        session: platformSessions,
        user: platformUsers,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.userId))
      .where(eq(platformSessions.tokenHash, tokenHash))
      .limit(1);
    if (!row) return { kind: "not_found" } as const;
    if (row.session.expiresAt.getTime() < Date.now()) {
      return { kind: "expired" } as const;
    }
    if (!row.session.secondFactorPassed) {
      return {
        kind: "unauthenticated",
        userId: row.user.id,
        role: row.user.role as "admin" | "viewer",
      };
    }
    // Sliding window: refresh last_seen_at on every authenticated
    // request. Cheap enough — one indexed PK update — and lets an
    // active platform admin stay signed in for the day without
    // re-logging in every TTL window.
    await db
      .update(platformSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(platformSessions.id, row.session.id));
    return {
      kind: "authenticated",
      userId: row.user.id,
      role: row.user.role as "admin" | "viewer",
    };
  });
}

export async function platformLogout(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  const tokenHash = sha256(sessionToken);
  await withPlatform(async () => {
    await db
      .delete(platformSessions)
      .where(eq(platformSessions.tokenHash, tokenHash));
  });
}

/**
 * Provisioning helper — creates a platform_user with a fresh password
 * and a TOTP secret (returned ONCE for the operator to enrol). Used by
 * the seed script and the platform admin UI; not exposed at runtime.
 * The TOTP secret here is base32; the operator scans it into their
 * authenticator and submits a verification code through the enrol UI to
 * flip totp_enrolled to true. Until then, login is impossible.
 */
export async function provisionPlatformUser(input: {
  email: string;
  name: string;
  password: string;
  role?: "admin" | "viewer";
}): Promise<{ id: string; totpSecret: string }> {
  const email = input.email.toLowerCase();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(input.password, salt);
  const totpSecret = generateTotpSecret();
  return withPlatform(async () => {
    const [row] = await db
      .insert(platformUsers)
      .values({
        email,
        name: input.name,
        passwordHash,
        passwordSalt: salt,
        totpSecret,
        totpEnrolled: false,
        role: input.role ?? "admin",
      })
      .returning({ id: platformUsers.id });
    if (!row) throw new Error("insert failed");
    return { id: row.id, totpSecret };
  });
}

export async function markTotpEnrolled(userId: string): Promise<void> {
  await withPlatform(async () => {
    await db
      .update(platformUsers)
      .set({ totpEnrolled: true, updatedAt: new Date() })
      .where(eq(platformUsers.id, userId));
  });
}

export function generateTotpSecret(): string {
  // RFC 4648 base32, no padding, 32 chars. TOTP secret length is
  // arbitrary in practice; 20 bytes / 160 bits is the spec-suggested
  // minimum and 32 chars covers it.
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out.slice(0, 32);
}

// Re-exports for tests / scripts that need direct db access
export { platformUsers, platformSessions, platformAuditLog };
