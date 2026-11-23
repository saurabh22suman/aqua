// Review-required exception: global phone lookup and bare account insert in
// the caller's authorized tenant transaction. No credential or membership.
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "./tenant";
import { users } from "./schema/users";

export async function enrollmentAccountByPhoneInTx(tx: TenantTx, phone: string): Promise<{ id: string; created: boolean } | null> {
  // The unique phone constraint serializes concurrent creators. A deleted
  // account is never revived; its collision falls through to a null result.
  const inserted = await tx.insert(users).values({ phone }).onConflictDoNothing({ target: users.phone }).returning({ id: users.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const rows = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt))).limit(1).for("share");
  return rows[0] ? { id: rows[0].id, created: false } : null;
}
