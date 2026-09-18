import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { accountEntries } from "@/db/schema/account-entries";
import { payments } from "@/db/schema/payments";
import { members } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { asMemberId } from "@/lib/ids";
import {
  deriveBalance,
  duplicateReference,
  insertEntry,
  lockMemberForEntry,
  replayResult,
  topUpInput,
  walletMutationInput,
  type WalletMutationResult,
} from "@/lib/services/wallet-core";
import type { AccountEntryDirection, AccountEntrySourceType } from "@/db/schema/account-entries";
import type { ActionCtx } from "@/lib/auth/context";

// K-05 — the member wallet ledger (fast-follow after Release 1).
//
// The ledger is append-only and every entry carries the balance it
// produced, so the balance is always re-derivable: `balanceOf` sums
// the entries and refuses to trust a stored `balance_after` that
// disagrees. Money enters through `topUp` — a counter payments row
// (invoice_id null, member + location + method + reference) and the
// matching credit entry in ONE transaction. A charge is a debit that
// is refused when it would take the balance negative; a refund is a
// compensating credit. Corrections are new entries, never edits; the
// app role has no UPDATE/DELETE grant (migration k05).
//
// Idempotency is per (tenant, idempotency_key). The member row is
// locked before the replay check, so same-member replays and
// concurrent debits serialise on one row; a replay inserts nothing —
// not even the payments row — and returns the existing entry. The
// shared primitives live in wallet-core.ts; this file is the public
// surface.

export * from "./wallet-core";

export async function topUp(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WalletMutationResult> {
  const parsed = topUpInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid top-up.",
    };
  }
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, input.locationId)) {
      return { ok: false, error: "Location not found." };
    }

    const locked = await lockMemberForEntry(
      tx,
      ctx.tenantId,
      input.memberId,
      input.idempotencyKey,
    );
    if (locked.status === "missing") {
      return { ok: false, error: "Member not found." };
    }
    if (!locationVisible(access, locked.locationId)) {
      return { ok: false, error: "Member not found." };
    }
    if (locked.status === "replay") {
      return replayResult(locked.entry);
    }

    if (input.reference) {
      const duplicate = await duplicateReference(
        tx,
        ctx.tenantId,
        input.method,
        input.reference,
      );
      if (duplicate) return { ok: false, error: duplicate };
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        tenantId: ctx.tenantId,
        invoiceId: null,
        memberId: asMemberId(input.memberId),
        locationId: input.locationId,
        amountPaise: BigInt(input.amountPaise),
        method: input.method,
        channel: "counter",
        receivedAt: new Date(),
        receivedBy: actorId,
        reference: input.reference ?? null,
        status: "captured",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: payments.id });
    if (!payment) {
      return { ok: false, error: "The payment could not be saved." };
    }

    const entry = await insertEntry(tx, {
      tenantId: ctx.tenantId,
      memberId: asMemberId(input.memberId),
      direction: "credit",
      amountPaise: input.amountPaise,
      sourceType: "topup",
      sourceId: payment.id,
      idempotencyKey: input.idempotencyKey,
      actorId,
    });
    if (!entry.ok) return entry;

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "wallet.topup",
      entityType: "account_entry",
      entityId: entry.entryId,
      after: {
        paymentId: payment.id,
        memberId: input.memberId,
        direction: "credit",
        amountPaise: input.amountPaise,
        balanceAfterPaise: entry.balanceAfterPaise,
        method: input.method,
        reference: input.reference ?? null,
      },
    });

    return entry;
  });
}

async function mutate(
  ctx: ActionCtx,
  raw: unknown,
  direction: AccountEntryDirection,
  sourceType: AccountEntrySourceType,
  action: "wallet.charge" | "wallet.refund",
): Promise<WalletMutationResult> {
  const parsed = walletMutationInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid ledger input.",
    };
  }
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const locked = await lockMemberForEntry(
      tx,
      ctx.tenantId,
      input.memberId,
      input.idempotencyKey,
    );
    if (locked.status === "missing") {
      return { ok: false, error: "Member not found." };
    }
    if (locked.status === "replay") return replayResult(locked.entry);

    const entry = await insertEntry(tx, {
      tenantId: ctx.tenantId,
      memberId: asMemberId(input.memberId),
      direction,
      amountPaise: input.amountPaise,
      sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey,
      actorId,
    });
    if (!entry.ok) return entry;

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action,
      entityType: "account_entry",
      entityId: entry.entryId,
      after: {
        memberId: input.memberId,
        direction,
        amountPaise: input.amountPaise,
        balanceAfterPaise: entry.balanceAfterPaise,
        sourceId: input.sourceId ?? null,
      },
    });

    return entry;
  });
}

export async function charge(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WalletMutationResult> {
  return mutate(ctx, raw, "debit", "charge", "wallet.charge");
}

export async function refund(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WalletMutationResult> {
  return mutate(ctx, raw, "credit", "refund", "wallet.refund");
}

// The derived balance: sum(credits) - sum(debits), then compare the
// latest stored balance_after against that sum. A mismatch means the
// ledger has been written outside the service (or the arithmetic has
// drifted) — fail loudly rather than return a number the entries do
// not support.
export async function balanceOf(
  ctx: ActionCtx,
  memberId: string,
): Promise<number> {
  const parsed = z.string().uuid().safeParse(memberId);
  if (!parsed.success) {
    throw new Error("balanceOf: memberId is not a valid uuid");
  }
  const id = asMemberId(parsed.data);

  return withTenant(ctx.tenantId, async (tx) => {
    const memberRows = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.id, id)))
      .limit(1);
    if (!memberRows[0]) throw new Error("Member not found.");

    const derived = await deriveBalance(tx, ctx.tenantId, id);
    const [latest] = await tx
      .select({ balanceAfterPaise: accountEntries.balanceAfterPaise })
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.tenantId, ctx.tenantId),
          eq(accountEntries.memberId, id),
        ),
      )
      .orderBy(desc(accountEntries.createdAt), desc(accountEntries.id))
      .limit(1);
    if (latest && latest.balanceAfterPaise !== derived) {
      throw new Error(
        `Wallet ledger invariant violated for member ${id}: stored balance_after ${latest.balanceAfterPaise} does not match re-derived ${derived}.`,
      );
    }
    return Number(derived);
  });
}
