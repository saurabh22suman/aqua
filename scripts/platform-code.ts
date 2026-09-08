// Demo-only convenience: print the current TOTP code for the
// seeded platform operator. Computes from the stored secret; no
// phone, no authenticator app, no copy-paste of the 32-character
// secret. The point is to remove demo-day friction from the
// platform-login flow during a walkthrough.
//
// Usage:
//   DEMO_MODE=true pnpm platform:code
//   DEMO_MODE=true pnpm platform:code --email ops@aqua.local
//
// Demo-time shape: prints one 6-digit code (plus the seconds
// remaining in the current 30s step, so the operator knows when
// to refresh) and exits.
//
// Hard gates — see lib/env.ts for the corresponding boot-fail:
//   1. DEMO_MODE must be set to "true". The boot-fail in lib/env.ts
//      already prevents this script from running in production
//      (NODE_ENV=production + DEMO_MODE=true is a hard fail there).
//      This script layers on a runtime guard so the command is
//      unrunnable against a real deployment even from a shell
//      where the env is misconfigured.
//   2. NODE_ENV must not be "production", regardless of DEMO_MODE.
//      A misconfigured production shell with DEMO_MODE unset still
//      has no business printing a TOTP code — the secret exists in
//      the database, the script can read it, but the demo-time
//      convenience does not exist outside demo/dev.
//
// Both gates echo a short explanation and exit 1, matching the
// shape of scripts/seed-demo.ts and scripts/demo-reset.ts so an
// operator who hits one of them can diagnose from the message.

import { Pool } from "pg";
import { env } from "@/lib/env";
import { currentTotpCode } from "../db/platform-auth";

if (!env.DEMO_MODE) {
  console.error(
    "pnpm platform:code — DEMO_MODE is not enabled.\n" +
      "This command is a demo-time convenience only. Set\n" +
      "DEMO_MODE=true in your environment to permit it.",
  );
  process.exit(1);
}
if (env.NODE_ENV === "production") {
  console.error(
    "pnpm platform:code — refusing to run in production.\n" +
      "This command must never exist in a real deployment path.\n" +
      "If you got here from CI or a staging shell, the env is\n" +
      "misconfigured; demo-time TOTP convenience does not apply.",
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

function secondsRemainingInStep(now = Date.now()): number {
  return 30 - Math.floor((now / 1000) % 30);
}

async function main() {
  const args = parseArgs();
  const email = args.email;
  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    // Pick the seeded operator. If --email is given, honour it;
    // otherwise take the most recent enrolled operator — there is
    // typically exactly one in a demo, and the script is meant to
    // be "give me the code", not "navigate a list".
    const rows = email
      ? await admin.query<{ id: string; email: string; totp_secret: string }>(
          `select id, email, totp_secret
             from platform_users
            where email = $1 and totp_enrolled = true
            limit 1`,
          [email],
        )
      : await admin.query<{ id: string; email: string; totp_secret: string }>(
          `select id, email, totp_secret
             from platform_users
            where totp_enrolled = true
            order by created_at desc
            limit 1`,
        );
    if (rows.rows.length === 0) {
      console.error(
        "pnpm platform:code — no enrolled platform operator found.\n" +
          "Run `pnpm seed:platform-user --email <addr>` first.",
      );
      process.exit(1);
    }
    const u = rows.rows[0]!;
    const code = currentTotpCode(u.totp_secret);
    const secs = secondsRemainingInStep();
    // Single line, single number, scannable. Operator copies into
    // the /ops/verify TOTP field.
    console.log(`${code}  (refresh in ${secs}s — email: ${u.email})`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
