import { createHash } from "node:crypto";
import { resolveDefaultMembership } from "@/db/platform";
import { parseFacilityValue } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";

type CookieReader = { get: (name: string) => { value: string } | undefined };
type OwnerIdentity = { userId: string; tenantId: string };

function preferenceKey(prefix: string, ...identity: string[]): string {
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return `${prefix}_${key}`;
}

export function ownerDefaultFacilityKey(identity: OwnerIdentity): string {
  return preferenceKey("aqua_owner_open", identity.userId, identity.tenantId);
}

export function lastBusinessKey(betterAuthUserId: string): string {
  return preferenceKey("aqua_last_business", betterAuthUserId);
}

export const workspacePreferenceCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 365 * 24 * 60 * 60,
} as const;

export async function ownerStartPath(
  path: string,
  betterAuthUserId: string,
  tenantId: string | undefined,
  store: CookieReader,
): Promise<string> {
  if (path !== "/owner") return path;
  const membership = await resolveDefaultMembership(betterAuthUserId, tenantId);
  if (!membership || membership.requiresSelection) return "/owner?facility=all";

  const saved = parseFacilityValue(store.get(ownerDefaultFacilityKey(membership))?.value);
  const facility = saved && await canSelectFacility(membership, saved) ? saved : "all";
  return `/owner?facility=${facility}`;
}
