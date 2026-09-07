// Seed a platform operator account for development. Re-runnable: if
// the email already exists, the existing user is reset (password
// regenerated and re-printed, 2FA secret re-issued — both printed
// below so a developer can complete enrolment in their authenticator).
//
// Usage:
//   pnpm seed:platform-user --email ops@aqua.test --name "Ops User"
// Without --email the script uses a default and warns loudly.

import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import qrcode from "qrcode";
import { env } from "@/lib/env";
import {
  provisionPlatformUser,
  markTotpEnrolled,
  currentTotpCode,
} from "../db/platform-auth";

// Demo reset path. The operator provisioning the platform login via
// this script is doing demo / local-dev work — gate it the same way
// scripts/seed-demo.ts is gated, so an accidental run against a real
// environment can't write a platform operator.
if (!env.DEMO_MODE) {
  console.error(
    "DEMO_MODE is not enabled — refusing to seed platform operator.\n" +
      "Set DEMO_MODE=true in your environment to permit this script.",
  );
  process.exit(1);
}

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

// otpauth:// URI per the KeyURI format (Google Authenticator compatible).
// The label is "{issuer}:{account}" — many authenticators split on the
// colon and treat the right side as the account. URL-encoded to be
// safe in any URI parser.
function otpauthUri(args: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = `${args.issuer}:${args.account}`;
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
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

    const issuer = "Aqua";
    const uri = otpauthUri({ issuer, account: email, secret: totpSecret });
    // Render the QR to a UTF-8 block-character string so it pastes
    // straight into any terminal that supports Unicode (iTerm,
    // macOS Terminal, GNOME Terminal, VS Code's terminal — all
    // verified). Google Authenticator's scanner accepts both the
    // URI and the rendered QR; most authenticator apps do.
    const qrText = await qrcode.toString(uri, {
      type: "terminal",
      errorCorrectionLevel: "M",
      margin: 1,
    });

    console.log("");
    console.log("=== Platform operator seeded ===");
    console.log(`id           ${id}`);
    console.log(`email        ${email}`);
    console.log(`password     ${password}`);
    console.log(`totp secret  ${totpSecret}`);
    console.log(`otpauth URI  ${uri}`);
    console.log(`current code ${currentTotpCode(totpSecret)} (use this to verify, or scan the QR below into an authenticator app)`);
    console.log("");
    console.log(qrText);
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
