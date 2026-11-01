import { createHmac, randomBytes } from "node:crypto";
import { constantTimeEqual } from "./platform-auth-crypto";

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
 * Generate the current 6-digit TOTP code for a given secret. RFC 6238
 * with SHA-1, 30s step. The mirror of verifyTotp without the
 * constant-time compare — the caller already knows the secret, so
 * the code is for them; the verify path stays where it is. Used by
 * the demo seed and the demo-only `pnpm platform:code` convenience
 * script.
 */
export function currentTotpCode(secret: string, now = Date.now()): string {
  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return "000000";
  }
  if (secretBytes.length < 10) return "000000";
  const counter = Math.floor(now / 1000 / 30);
  const counterHex = counter.toString(16).padStart(16, "0");
  const hmac = createHmac("sha1", secretBytes)
    .update(Buffer.from(counterHex, "hex"))
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP code against the user's secret. RFC 6238 with
 * SHA-1, 30s step, ±1 step window (90s total) for clock skew. Constant
 * time on candidate comparison.
 */
export function matchingTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return null;
  }
  if (secretBytes.length < 10) return null;
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
    if (constantTimeEqual(candidate, code)) return counter + i;
  }
  return null;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  return matchingTotpStep(secret, code, now) !== null;
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
