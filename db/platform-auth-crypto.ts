import {
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";

// Shared crypto + error primitives for the platform login (DB+TOTP
// and env paths). Split from db/platform-auth.ts so that file stays
// manageable and the env-login module can share the exact same
// hashing/comparison code without importing through the login flow.

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

export function hashPassword(password: string, salt: string): string {
  // scrypt: deterministic for (password, salt); no pepper here — a
  // leaked DB does not leak the production password hashes alone. The
  // verification path recomputes with the stored salt and compares with
  // timingSafeEqual. Cost 16384 is the Node default — bump for a higher
  // attack budget if/when offline cracking becomes a real concern.
  return scryptSync(password, salt, 64, { N: SCRYPT_N }).toString("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sha256(input: string): string {
  return createHmac("sha256", "platform-session-token-v1")
    .update(input)
    .digest("hex");
}

// Ops env credentials (2026-09-11 auth feature): constant-time
// comparison of two arbitrary-length strings. Hash both to a fixed
// length so timingSafeEqual never sees mismatched lengths (which
// would itself leak the length).
export function constantTimeStringEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
