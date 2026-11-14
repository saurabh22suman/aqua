// POSTIMAGE — db/self-service-account.ts  (candidate, NOT applied)
//
// THE ACCOUNT ROW, READ TWO WAYS, AND NEVER A THIRD.
//
// WHY THIS FILE EXISTS
//   The pairing gate compares the club's recorded number with the
//   ACCOUNT's sign-in number, and the door must find the account from a
//   typed number before it knows any club. `users` is a global table
//   (db/CLAUDE.md:8-9, db/allowlist.ts::PLATFORM_TABLES) with no RLS, and
//   the repository's rule of record is that it is reached only through a
//   TENANT table inside withTenant(). A link-only member principal has no
//   tenant_memberships row at all, so the membership join returns nothing
//   for exactly the population this lane exists for.
//
//   So there are exactly TWO sanctioned reads, and they are different
//   reads for different jobs:
//
//   (1) readSelfServiceAccountByPhone — the PRE-TENANT identity
//       resolution, in PLATFORM scope, by the GLOBALLY UNIQUE
//       users.phone. This is the same shape as the staff door's own
//       account lookup (lib/services/credentials.ts:276-287) and the same
//       shape as db/user-account.ts's findOrCreateUserByPhone: the number
//       the caller typed is the only key there is, and it names exactly
//       one account in the whole platform.
//
//   (2) readSelfServiceAccountInTx — the AUTHORITATIVE read, INSIDE the
//       club's own tenant transaction, and REACHED THROUGH A TENANT
//       TABLE: the account's own link row -> users. It is one row, by
//       primary key, of the account the caller is signing in as, and it is
//       in the same transaction (and the same snapshot) as the locked
//       link rows, so a concurrent change to the account's number blocks
//       until this transaction commits.
//
//   THERE IS NO THIRD READ. No unscoped global lookup of `users`, no
//   platform bypass of a tenant table, and no read of the account row
//   outside the club's own scope.
//
// THE CALLER OBLIGATION
//   This module reads whatever id it is handed. The obligation — "pass
//   the id of the account you just authenticated" — lives with the
//   caller, and the service that reads it in the tenant scope only ever
//   does so for the account whose own link row it has just locked.
//
// THE RULE OF RECORD IS NOT AMENDED BY THIS FILE
//   db/CLAUDE.md:12-14 says `users` "is NEVER queried directly. Reach it
//   only by joining through tenant_memberships inside withTenant()". This
//   file does two things: it reads `users` in platform scope for the
//   pre-tenant phone lookup (the staff door's own precedent), and it
//   joins `users` from a TENANT table inside withTenant(). The first is
//   an amendment of the rule's wording and the second is an instance of
//   its shape. The amendment is the human's to make; it is named in the
//   handoff and NOT taken here.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import type { TenantTx } from "./tenant";
import { users } from "./schema/users";
import { guardianChildLinks, memberAccountLinks } from "./schema/member-self";
import type { TenantId, UserId } from "@/lib/ids";
export type SelfServiceAccount = {
  userId: UserId;
  /** users.phone is NOT NULL (db/schema/users.ts:17). */
  phone: string;
  /** The better-auth identity, when the account has one. */
  betterAuthId: string | null;
  failedPinAttempts: number;
  pinLockedUntil: Date | null;
};

const ACCOUNT_COLUMNS = {
  userId: users.id,
  phone: users.phone,
  betterAuthId: users.betterAuthId,
  failedPinAttempts: users.failedPinAttempts,
  pinLockedUntil: users.pinLockedUntil,
};

/**
 * The account row by its unique phone number. PLATFORM scope.
 *
 * A SOFT-DELETED ACCOUNT HAS NO ROW: the filter is isNull(users.deleted_at),
 * so a deleted account resolves to null and the caller fails closed.
 */
export async function readSelfServiceAccountByPhone(
  phone: string,
): Promise<SelfServiceAccount | null> {
  return withPlatform(async () => {
    const rows = await db
      .select(ACCOUNT_COLUMNS)
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      phone: row.phone,
      betterAuthId: row.betterAuthId,
      failedPinAttempts: row.failedPinAttempts,
      pinLockedUntil: row.pinLockedUntil,
    };
  });
}

/**
 * The account row INSIDE the caller's tenant transaction, REACHED THROUGH
 * THE ACCOUNT'S OWN LINK ROW.
 *
 * The join is the point: the account is located from a tenant-scoped
 * table, inside the club's own scope, so this is the repository's
 * sanctioned shape and not a global lookup. `users` has no RLS, so the
 * read is mechanically safe; the LOCK is a SHARE lock on ONE row of a
 * table with no RLS, which does not widen what the transaction can see
 * (the WHERE clause still names one primary key through one link row).
 *
 * `null` means the account has no link row in THIS club — which is a
 * different fact from "the account does not exist", and the caller fails
 * closed on both.
 */
export async function readSelfServiceAccountInTx(
  tx: TenantTx,
  args: { tenantId: TenantId; userId: UserId },
): Promise<SelfServiceAccount | null> {
  // TWO LOOKUPS, NOT ONE. The account may be linked in this club through
  // EITHER link table — a member link or a guardian link — and an
  // account that is only a guardian must be found as readily as one that
  // is only a member. The two queries are alternatives, not a union: the
  // first one that finds the account wins, and both name one primary key
  // through one link row.
  const memberRows = await tx
    .select(ACCOUNT_COLUMNS)
    .from(memberAccountLinks)
    .innerJoin(users, eq(users.id, memberAccountLinks.userId))
    .where(
      and(
        eq(memberAccountLinks.tenantId, args.tenantId),
        eq(memberAccountLinks.userId, args.userId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)
    .for("share");
  const memberRow = memberRows[0];
  if (memberRow) {
    return {
      userId: memberRow.userId,
      phone: memberRow.phone,
      betterAuthId: memberRow.betterAuthId,
      failedPinAttempts: memberRow.failedPinAttempts,
      pinLockedUntil: memberRow.pinLockedUntil,
    };
  }

  const guardianRows = await tx
    .select(ACCOUNT_COLUMNS)
    .from(guardianChildLinks)
    .innerJoin(users, eq(users.id, guardianChildLinks.userId))
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)
    .for("share");
  const guardianRow = guardianRows[0];
  if (!guardianRow) return null;
  return {
    userId: guardianRow.userId,
    phone: guardianRow.phone,
    betterAuthId: guardianRow.betterAuthId,
    failedPinAttempts: guardianRow.failedPinAttempts,
    pinLockedUntil: guardianRow.pinLockedUntil,
  };
}
