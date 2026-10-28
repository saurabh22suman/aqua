"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  platformLogin,
  platformVerifyTotp,
  lookupPlatformSession,
  platformLogout,
  PlatformAuthError,
} from "@/db/platform-auth";
import {
  readPlatformSessionToken,
  writePlatformSessionCookie,
  clearPlatformSessionCookie,
} from "@/lib/auth/platform-cookie";
import { platformRequestMeta } from "@/lib/auth/platform-request-meta";

// Every action opens with (1) parse, (2) — here the second line is the
// permission check, which lives in the platform scope itself
// (withPlatform() + the row's role column). The Server Action preamble
// test walks the AST and asserts .parse()/.safeParse() is the FIRST
// statement of every action. Keeping that contract intact matters.
//
// H1 — Server Action form pattern. loginPlatformAction and
// verifyPlatformTotpAction now take FormData so the login / verify
// forms can use <form action={fn}> rather than onSubmit. Pre-hydration
// submits (cold Next.js dev compile, JS disabled, hydration race) POST
// to the server action endpoint instead of falling through to a native
// GET that puts the password in the URL.

const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

const verifyInput = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export type PlatformLoginResult =
  | { kind: "error"; message: string };

export async function loginPlatformAction(
  _prevState: unknown,
  formData: FormData,
): Promise<PlatformLoginResult> {
  const parsed = loginInput.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { kind: "error", message: "Enter a valid email and password." };
  }
  // Both configured-env and database passwords require the authenticator.
  let fullyAuthenticated = false;
  try {
    const result = await platformLogin(parsed.data, await platformRequestMeta());
    // The cookie is host-scoped: it is written without a Domain
    // attribute, so the platform session never reaches the tenant
    // apex and the tenant session never reaches the platform host.
    await writePlatformSessionCookie(result.sessionToken);
    fullyAuthenticated = result.kind === "fully_authenticated";
  } catch (err) {
    if (err instanceof PlatformAuthError) {
      if (err.code === "no_totp") {
        return {
          kind: "error",
          message:
            "This account has no enrolled second factor. Contact another operator to finish enrolment.",
        };
      }
      if (err.code === "user_suspended") {
        return { kind: "error", message: "This account is suspended." };
      }
      return { kind: "error", message: "Wrong email or password." };
    }
    throw err;
  }
  // redirect() is a framework signal; keep it outside the catch.
  redirect(fullyAuthenticated ? "/ops" : "/ops/verify");
}

export type PlatformVerifyResult =
  | { kind: "error"; message: string };

export async function verifyPlatformTotpAction(
  _prevState: unknown,
  formData: FormData,
): Promise<PlatformVerifyResult> {
  const parsed = verifyInput.safeParse({
    code: String(formData.get("code") ?? ""),
  });
  if (!parsed.success) {
    return { kind: "error", message: "Enter the 6-digit code from your authenticator." };
  }
  const token = await readPlatformSessionToken();
  if (!token) redirect("/ops/login");
  try {
    const result = await platformVerifyTotp({ sessionToken: token, code: parsed.data.code }, await platformRequestMeta());
    await writePlatformSessionCookie(result.sessionToken);
  } catch (err) {
    if (err instanceof PlatformAuthError) {
      return { kind: "error", message: "Invalid or expired code. Try again later or start sign-in again." };
    }
    throw err;
  }
  redirect("/ops");
}

export type PlatformLogoutResult = { kind: "ok" };

export async function logoutPlatformAction(): Promise<PlatformLogoutResult> {
  const token = await readPlatformSessionToken();
  if (token) await platformLogout(token);
  await clearPlatformSessionCookie();
  return { kind: "ok" };
}

export type PlatformAuthStatus =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "unauthenticated"; userId: string; role: "admin" | "viewer" }
  | { kind: "authenticated"; userId: string; role: "admin" | "viewer" };

export async function platformAuthStatusAction(): Promise<PlatformAuthStatus> {
  const token = await readPlatformSessionToken();
  if (!token) return { kind: "not_found" };
  return lookupPlatformSession(token);
}

// R03 (2026-10-13 role-workflow audit) — the authoritative admin gate
// for platform mutations. `platform_users.role` is resolved from the
// validated session token (lookupPlatformSession), never from a
// client-supplied field; viewers are read-only. Every mutating
// platform action calls this before any write or enqueue; db/ops-action
// re-checks the actor row inside opsAction as defence in depth, and
// scripts/check-ops-actions.ts pins the call site mechanically.
export type OpsAdminGate =
  | { kind: "ok"; userId: string; role: "admin" }
  | { kind: "error"; reason: "unauthenticated" | "forbidden" };

export async function requireOpsAdminAction(): Promise<OpsAdminGate> {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return { kind: "error", reason: "unauthenticated" };
  }
  if (status.role !== "admin") {
    return { kind: "error", reason: "forbidden" };
  }
  return { kind: "ok", userId: status.userId, role: "admin" };
}
