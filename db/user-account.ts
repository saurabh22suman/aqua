import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema/users";
import { asUserId, type UserId } from "@/lib/ids";

// Phase 3.6 — user (identity) lookup helpers for the staff
// invitations service. Identity belongs on the platform side;
// importing db directly from lib/ would violate the lint rule
// (raw client bypasses tenant scoping) and miss every gate in
// place against it. The helpers live here so lib/services can
// call `withPlatform(() => findOrCreateUserByPhone(...))`
// without ever importing the client directly.

export async function findOrCreateUserByPhone(
  phone: string,
): Promise<{ id: string; wasNew: boolean }> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existing[0]) return { id: existing[0]!.id, wasNew: false };
  const inserted = await db
    .insert(users)
    .values({ phone })
    .returning({ id: users.id });
  return { id: inserted[0]!.id, wasNew: true };
}

// `users.id` is branded UserId; the caller often has plain
// strings (from invites, deduplicated ids, etc). The cast at
// this boundary is the single place a string → UserId brand
// conversion happens for the helper, keeping callers untyped
// about ids.
export async function findPhonesByUserIds(
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const branded: UserId[] = userIds.map((u) => asUserId(u));
  const rows = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(inArray(users.id, branded));
  const out = new Map<string, string>();
  for (const r of rows) {
    out.set(r.id, r.phone);
  }
  return out;
}
