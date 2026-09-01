"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { resolveSessionForLogin, type SessionResolution } from "@/db/platform";
import { devVerificationCode } from "@/db/platform";
import { phoneNumberSchema } from "@/lib/schemas";

// Phase 1.6 — `homeForSessionAction` now distinguishes the
// "operational tenant available" path (returns the role's home
// path) from a "tenant blocked" path (returns a discriminated
// 'suspended' result so the login form can show a clear message).
// 'none' is the existing not-found case where the user has no
// active memberships at all. Three sources of false-attempts are
// split apart: a typed session for each, instead of two return
// values that conflate suspended-tenant with no-membership.
//
// Stayed a discriminated union rather than a string sentinel path
// because the caller (login form) already has to branch on the
// shape; string sentinels leak control flow into URL conventions
// that the next caller is going to break.
export async function homeForSessionAction(): Promise<SessionResolution> {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return { kind: "none" };
  return resolveSessionForLogin(session.user.id);
}

export async function devCodeAction(rawPhone: string): Promise<string | null> {
  const phone = phoneNumberSchema.parse(rawPhone);
  if (process.env.NODE_ENV === "production") return null;
  return devVerificationCode(phone);
}
