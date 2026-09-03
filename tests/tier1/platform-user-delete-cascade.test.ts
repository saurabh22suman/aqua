import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import {
  provisionPlatformUser,
  markTotpEnrolled,
  platformLogin,
  platformVerifyTotp,
} from "@/db/platform-auth";

// scripts/seed-platform-user.ts is documented in docs/demo-runbook.md as
// the recovery path when a platform login is stuck: it deletes the
// platform_users row for the email and re-provisions a fresh one. Once
// that user has logged in even once, a platform_audit_log row exists
// with actor_id pointing at them (written by platformVerifyTotp). The
// FK on platform_audit_log.actor_id had no ON DELETE clause (defaults
// to NO ACTION), so the delete threw platform_audit_log_actor_id_fkey —
// the documented recovery path crashed exactly when it was needed.
// Migration 20260903033254_platform_audit_log_actor_cascade.sql fixes
// this to ON DELETE SET NULL: the audit row survives (audit trails are
// append-only), the actor reference just goes null.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

afterAll(async () => {
  await admin.end();
});

function currentTotp(secret: string): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret.replace(/=+$/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const v = ALPHABET.indexOf(ch);
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
  const hmac = createHmac("sha1", key).update(Buffer.from(counterHex, "hex")).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

describe("re-provisioning a platform user after they've logged in", () => {
  it("deletes the platform_users row without an FK violation, leaving the audit row with a null actor", async () => {
    const email = `reprovision-${RUN}@platform.test`;
    const password = `pw-${RUN}`;
    const { id, totpSecret } = await provisionPlatformUser({
      email,
      name: "Reprovision Test",
      password,
      role: "admin",
    });
    await markTotpEnrolled(id);

    const loginResult = await platformLogin({ email, password });
    if (loginResult.kind !== "second_factor_required") {
      throw new Error("unexpected login result");
    }
    const verifyResult = await platformVerifyTotp({
      sessionToken: loginResult.sessionToken,
      code: currentTotp(totpSecret),
    });
    if (verifyResult.kind !== "fully_authenticated") {
      throw new Error("unexpected verify result");
    }

    const auditBefore = await admin.query(
      "select id, actor_id from platform_audit_log where actor_id = $1",
      [id],
    );
    expect(auditBefore.rows.length).toBeGreaterThan(0);

    // This is exactly what scripts/seed-platform-user.ts:78 does on a
    // re-run for an existing email.
    await admin.query("delete from platform_users where email = $1", [email]);

    const auditAfter = await admin.query(
      "select id, actor_id from platform_audit_log where id = $1",
      [auditBefore.rows[0].id],
    );
    expect(auditAfter.rows).toHaveLength(1);
    expect(auditAfter.rows[0].actor_id).toBeNull();
  });
});
