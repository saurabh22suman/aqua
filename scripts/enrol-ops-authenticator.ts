// Trusted terminal only; never imported by a request path. No password changes.
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../db/client";
import { withPlatform } from "../db/scope";
import { platformUsers, platformAuditLog } from "../db/schema/platform-users";
import { generateTotpSecret, verifyTotp } from "../db/platform-auth";

const emailInput = z.string().trim().email().transform(value => value.toLowerCase());

export async function prepareOperatorTotp(email: string): Promise<{ secret: string; uri: string } | null> {
  const parsed = emailInput.safeParse(email);
  if (!parsed.success) return null;
  return withPlatform(() => db.transaction(async tx => {
    const [user] = await tx.select().from(platformUsers)
      .where(eq(platformUsers.email, parsed.data)).for("update");
    if (!user || user.status !== "active" || user.totpEnrolled) return null;
    const secret = user.totpSecret ?? generateTotpSecret();
    await tx.update(platformUsers).set({ totpSecret: secret, updatedAt: new Date() })
      .where(eq(platformUsers.id, user.id));
    await tx.insert(platformAuditLog).values({
      action: "platform.mfa.enrolment_started", targetType: "platform_user", targetId: user.id,
      detail: { channel: "operator_terminal" },
    });
    const label = encodeURIComponent(`KhelSuite Ops:${user.email}`);
    return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=KhelSuite%20Ops&algorithm=SHA1&digits=6&period=30` };
  }));
}

export async function confirmOperatorTotp(email: string, code: string): Promise<boolean> {
  const parsed = emailInput.safeParse(email);
  if (!parsed.success || !/^\d{6}$/.test(code)) return false;
  return withPlatform(() => db.transaction(async tx => {
    const [user] = await tx.select().from(platformUsers)
      .where(eq(platformUsers.email, parsed.data)).for("update");
    if (!user || user.status !== "active" || user.totpEnrolled || !user.totpSecret || !verifyTotp(user.totpSecret, code)) return false;
    await tx.update(platformUsers).set({ totpEnrolled: true, updatedAt: new Date() })
      .where(eq(platformUsers.id, user.id));
    await tx.insert(platformAuditLog).values({
      action: "platform.mfa.enrolled", targetType: "platform_user", targetId: user.id,
      detail: { channel: "operator_terminal" },
    });
    return true;
  }));
}

async function main() {
  const [mode, email, extra] = process.argv.slice(2);
  if (!email || extra || !["prepare", "confirm"].includes(mode)) {
    throw new Error("Usage: enrol-ops-authenticator.ts prepare|confirm EMAIL (confirmation code on stdin)");
  }
  if (mode === "prepare") {
    // A provisioning URI is a credential: refuse unattended output/log redirection.
    if (!process.stdout.isTTY) throw new Error("Preparation requires a private interactive terminal.");
    const result = await prepareOperatorTotp(email);
    if (!result) throw new Error("Account unavailable or already enrolled; no changes made.");
    console.log("Add this key to your authenticator privately. Do not save or share this output:");
    console.log(result.secret);
    console.log(result.uri);
    console.log("Enrolment remains pending until a code is confirmed.");
    return;
  }
  if (process.stdin.isTTY) throw new Error("Pipe the confirmation code through stdin; never put it in command arguments.");
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 32) throw new Error("Invalid confirmation input.");
  }
  if (!await confirmOperatorTotp(email, input.trim())) throw new Error("Confirmation refused; no enrolment completed.");
  console.log("Authenticator enrolled. Password and role preserved.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Do not print driver exceptions which may contain provisioning parameters.
    console.error("Enrolment failed. Check the account, command and private terminal; no credentials were reset.");
    process.exitCode = 1;
  }).finally(() => pool.end());
}
