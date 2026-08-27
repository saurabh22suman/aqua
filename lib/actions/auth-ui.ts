"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { resolveHomePath, devVerificationCode } from "@/db/platform";
import { phoneNumberSchema } from "@/lib/schemas";


export async function homeForSessionAction(): Promise<string | null> {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return null;
  return resolveHomePath(session.user.id);
}

export async function devCodeAction(rawPhone: string): Promise<string | null> {
  const phone = phoneNumberSchema.parse(rawPhone);
  if (process.env.NODE_ENV === "production") return null;
  return devVerificationCode(phone);
}
