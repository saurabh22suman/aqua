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
  try {
    const result = await platformLogin(parsed.data);
    if (result.kind !== "second_factor_required") {
      // fully_authenticated cannot happen here — platformLogin refuses
      // to mark a session fully_authenticated; that is platformVerifyTotp's
      // job. Treat as unreachable but type-narrow defensively.
      return { kind: "error", message: "Unexpected login state." };
    }
    await writePlatformSessionCookie(result.sessionToken);
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
  redirect("/platform/verify");
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
  if (!token) {
    return {
      kind: "error",
      message: "Sign-in expired. Enter your email and password again.",
    };
  }
  try {
    const result = await platformVerifyTotp({
      sessionToken: token,
      code: parsed.data.code,
    });
    if (result.kind !== "fully_authenticated") {
      return { kind: "error", message: "Unexpected verify state." };
    }
  } catch (err) {
    if (err instanceof PlatformAuthError) {
      if (err.code === "invalid_totp") {
        return { kind: "error", message: "Wrong code. Try again." };
      }
      if (err.code === "session_expired" || err.code === "session_invalid") {
        await clearPlatformSessionCookie();
        return {
          kind: "error",
          message: "Sign-in expired. Enter your email and password again.",
        };
      }
      if (err.code === "no_totp") {
        return {
          kind: "error",
          message: "Second factor is not enrolled on this account.",
        };
      }
      if (err.code === "user_suspended") {
        return { kind: "error", message: "This account is suspended." };
      }
    }
    throw err;
  }
  redirect("/platform");
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