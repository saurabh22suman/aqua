import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { TenantTx } from "@/db/tenant";
import { accountEntries } from "@/db/schema/account-entries";
import { payments } from "@/db/schema/payments";
import { members } from "@/db/schema/people";
import { formatINR } from "@/lib/money/format";
import { MAX_PAYMENT_PAISE } from "@/lib/services/payments";
import { asMemberId } from "@/lib/ids";
import type { AccountEntryDirection, AccountEntrySourceType } from "@/db/schema/account-entries";
import type { MemberId, TenantId, UserId } from "@/lib/ids";

// K-05 — shared shapes and the in-transaction primitives for the
// member wallet ledger. lib/services/wallet.ts carries the public
// surface (topUp / charge / refund / balanceOf); this file holds the
// zod inputs, the member lock + idempotency replay check, the
// balance re-derivation and the append. Split out for the 300-line
// rule, same boundary as lib/services/orders-core.ts.

const idempotencyKey = z.string().trim().min(1).max(200);
const walletAmount = z.number().int().positive().max(MAX_PAYMENT_PAISE);

export const topUpInput = z
  .object({
    memberId: z.string().uuid(),
    locationId: z.string().uuid(),
    amountPaise: walletAmount,
    method: z.enum(["cash", "upi", "card", "other"]),
    reference: z.string().trim().min(1).max(120).optional(),
    idempotencyKey,
  })
  .refine(
    (value) => value.method === "cash" || (value.reference?.length ?? 0) > 0,
    {
      message:
        "A non-cash top-up needs its reference (UTR / terminal / transaction id).",
      path: ["reference"],
    },
  )
  .refine((value) => value.method !== "cash" || value.reference === undefined, {
    message: "Cash top-ups do not carry a reference.",
    path: ["reference"],
  });

export type TopUpInput = z.input<typeof topUpInput>;

export const walletMutationInput = z.object({
  memberId: z.string().uuid(),
  amountPaise: walletAmount,
  sourceId: z.string().uuid().nullish(),
  idempotencyKey,
});

export type WalletMutationInput = z.input<typeof walletMutationInput>;

export type WalletMutationResult =
  | { ok: true; entryId: string; balanceAfterPaise: number; replayed: boolean }
  | { ok: false; error: string };

export type EntryRow = typeof accountEntries.$inferSelect;

export function replayResult(entry: EntryRow): WalletMutationResult {
  return {
    ok: true,
    entryId: entry.id,
    balanceAfterPaise: Number(entry.balanceAfterPaise),
    replayed: true,
  };
}

// Lock the member row first — this is what serialises concurrent
// appends for one member, so two debits cannot both read the same
// balance. The replay check runs AFTER the lock: a request that was
// waiting on the lock sees the committed winner and replays it.
export async function lockMemberForEntry(
  tx: TenantTx,
  tenantId: TenantId,
  memberId: string,
  key: string,
): Promise<
  | { status: "missing" }
  | { status: "replay"; entry: EntryRow; locationId: string }
  | { status: "locked"; locationId: string }
> {
  const rows = await tx
    .select({ id: members.id, locationId: members.locationId })
    .from(members)
    .where(
      and(
        eq(members.tenantId, tenantId),
        eq(members.id, asMemberId(memberId)),
      ),
    )
    .for("update");
  const member = rows[0];
  if (!member) return { status: "missing" };

  const existing = await tx
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.tenantId, tenantId),
        eq(accountEntries.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return {
      status: "replay",
      entry: existing[0],
      locationId: member.locationId,
    };
  }

  return { status: "locked", locationId: member.locationId };
}

export async function deriveBalance(
  tx: TenantTx,
  tenantId: TenantId,
  memberId: MemberId,
): Promise<bigint> {
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(case when ${accountEntries.direction} = 'credit' then ${accountEntries.amountPaise} else -${accountEntries.amountPaise} end), 0)::text`,
    })
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.tenantId, tenantId),
        eq(accountEntries.memberId, memberId),
      ),
    );
  return BigInt(row?.balance ?? "0");
}

export async function insertEntry(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    memberId: MemberId;
    direction: AccountEntryDirection;
    amountPaise: number;
    sourceType: AccountEntrySourceType;
    sourceId: string | null;
    idempotencyKey: string;
    actorId: UserId;
  },
): Promise<WalletMutationResult> {
  const current = await deriveBalance(tx, input.tenantId, input.memberId);
  const delta =
    input.direction === "credit"
      ? BigInt(input.amountPaise)
      : -BigInt(input.amountPaise);
  const next = current + delta;
  if (next < 0n) {
    return {
      ok: false,
      error: `Insufficient wallet balance: this member has ${formatINR(Number(current))}.`,
    };
  }

  const [entry] = await tx
    .insert(accountEntries)
    .values({
      tenantId: input.tenantId,
      memberId: input.memberId,
      direction: input.direction,
      amountPaise: BigInt(input.amountPaise),
      balanceAfterPaise: next,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.actorId,
    })
    .returning({ id: accountEntries.id });
  if (!entry) return { ok: false, error: "The ledger entry could not be saved." };

  return {
    ok: true,
    entryId: entry.id,
    balanceAfterPaise: Number(next),
    replayed: false,
  };
}

// Same reference rule as recordPayment: one UPI UTR / terminal
// reference cannot justify two payments. Returns the friendly error,
// or null when the reference is free (the partial unique index is
// the race backstop).
export async function duplicateReference(
  tx: TenantTx,
  tenantId: TenantId,
  method: string,
  reference: string,
): Promise<string | null> {
  const dupes = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.method, method),
        eq(payments.reference, reference),
      ),
    )
    .limit(1);
  return dupes.length > 0
    ? "This reference has already been used for another payment."
    : null;
}
