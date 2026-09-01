// Seed a platform operator account for development. Re-runnable: if
// the email already exists, the existing user is reset (password
// regenerated and re-printed, 2FA secret re-issued — both printed
// below so a developer can complete enrolment in their authenticator).
//
// Usage:
//   pnpm seed:platform-user --email ops@aqua.test --name "Ops User"
// Without --email the script uses a default and warns loudly.

import { Pool } from "pg";
import { randomBytes, createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { provisionPlatformUser, markTotpEnrolled } from "../db/platform-auth";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]?.replace(/^--/, "");
    const v = args[i + 1];
    if (k && v) out[k] = v;
  }
  return out;
}

function currentTotp(secret: string): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret.replace(/=+$/g, "").toUpperCase();
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
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterHex = counter.toString(16).padStart(16, "0");
  const hmac = createHmac("sha1", key)
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

async function main() {
  const args = parseArgs();
  const email = args.email ?? "ops@aqua.local";
  const name = args.name ?? "Default Operator";
  const password = args.password ?? randomBytes(12).toString("base64url");

  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    // re-runnable: delete any prior row for this email
    await admin.query("delete from platform_users where email = $1", [email]);

    const { id, totpSecret } = await provisionPlatformUser({
      email,
      name,
      password,
      role: "admin",
    });
    await markTotpEnrolled(id);

    console.log("");
    console.log("=== Platform operator seeded ===");
    console.log(`id           ${id}`);
    console.log(`email        ${email}`);
    console.log(`password     ${password}`);
    console.log(`totp secret  ${totpSecret}`);
    console.log(`current code ${currentTotp(totpSecret)} (use this to verify, or scan into an authenticator app and use the rolling code)`);
    console.log("===============================");
    console.log("");
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
