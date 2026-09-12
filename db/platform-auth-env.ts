import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import {
  PlatformAuthError,
  PLATFORM_SESSION_TTL_SECONDS,
  constantTimeStringEqual,
  hashPassword,
  sha256,
} from "./platform-auth-crypto";
import {
  platformUsers,
  platformSessions,
  platformAuditLog,
} from "./schema";

// Env-only operator login (2026-09-11 auth feature).
//
// When OPS_EMAIL + OPS_PASSWORD are configured they replace the DB
// credential check entirely, and the session is created fully
// authenticated (no TOTP). Removing the vars restores the DB+TOTP
// path in db/platform-auth.ts unchanged. The pair is validated at
// boot (lib/env.ts: both-or-neither, 12-char minimum).

// The env operator has no provisioned row; one is found-or-created on
// first successful login so sessions and audit rows have a stable FK
// anchor. The stored password hash is random and never used — this
// path bypasses it — but the columns are NOT NULL.
async function findOrCreateEnvOperator(
  email: string,
): Promise<{ id: string; role: "admin" | "viewer" }> {
  const canonical = email.toLowerCase();
  const [existing] = await db
    .select({ id: platformUsers.id, role: platformUsers.role })
    .from(platformUsers)
    .where(eq(platformUsers.email, canonical))
    .limit(1);
  if (existing) return { id: existing.id, role: existing.role as "admin" | "viewer" };
  const salt = randomBytes(16).toString("hex");
  const [created] = await db
    .insert(platformUsers)
    .values({
      email: canonical,
      name: "Ops (env)",
      passwordHash: hashPassword(randomBytes(32).toString("hex"), salt),
      passwordSalt: salt,
      role: "admin",
      status: "active",
    })
    .returning({ id: platformUsers.id, role: platformUsers.role });
  return { id: created!.id, role: created!.role as "admin" | "viewer" };
}

export async function loginWithEnvOperator(
  input: { email: string; password: string },
  meta: { ipAddress?: string; userAgent?: string },
  opsEmail: string,
  opsPassword: string,
): Promise<{
  kind: "fully_authenticated";
  sessionToken: string;
  userId: string;
  role: "admin" | "viewer";
}> {
  const emailOk = constantTimeStringEqual(
    input.email.toLowerCase(),
    opsEmail.toLowerCase(),
  );
  const passwordOk = constantTimeStringEqual(input.password, opsPassword);
  if (!emailOk || !passwordOk) {
    throw new PlatformAuthError("invalid_credentials", "invalid credentials");
  }
  const operator = await findOrCreateEnvOperator(opsEmail);
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_SECONDS * 1000);
  await db.insert(platformSessions).values({
    id: randomUUID(),
    userId: operator.id,
    tokenHash: sha256(sessionToken),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    secondFactorPassed: true,
    expiresAt,
  });
  await db.insert(platformAuditLog).values({
    actorId: operator.id,
    action: "platform.login",
    detail: { method: "env" },
    ipAddress: meta.ipAddress,
  });
  return {
    kind: "fully_authenticated",
    sessionToken,
    userId: operator.id,
    role: operator.role,
  };
}
