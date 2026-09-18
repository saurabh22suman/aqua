import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { accountEntries } from "@/db/schema";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";

// K-05 — the member wallet ledger (fast-follow, account_entries).
// Written before db/migrations/20260918130000_k05_account_entries.sql
// and lib/services/wallet.ts exist: the first run is deliberately red.
//
// Money rules under test, each with a named mutation proof in the
// task report:
//   1. the ledger re-derives exactly (every stored balance_after
//      equals the running sum from the entries);
//   2. a debit that would take the balance negative is refused and
//      writes nothing;
//   3. a duplicate idempotency key replays the existing entry and
//      inserts nothing — not even a second payments row;
//   4. cross-tenant reads return zero rows;
//   5. app_user can INSERT + SELECT but has no UPDATE/DELETE grant.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const loc = uuidv7();
const actor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());
const secondPersonId = uuidv7();
const secondMemberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let wallet: typeof import("@/lib/services/wallet");

async function auditCount(action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenant, action],
  );
  return Number(rows[0]?.count ?? "0");
}

async function entryCount(member = memberId): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from account_entries where member_id = $1",
    [member],
  );
  return Number(rows[0]?.count ?? "0");
}

async function paymentCount(): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from payments where tenant_id = $1",
    [tenant],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  wallet = await import("@/lib/services/wallet");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Wallet Tenant', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Wallet Other', 'active', 'Asia/Kolkata')`,
    [tenant, `k05-${RUN}`, otherTenant, `k05-b-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Counter', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9193${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $3, 'Wallet Member'), ($2, $3, 'Wallet Second')`,
    [personId, secondPersonId, tenant],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status) values
       ($1, $3, $4, $6, $7, 'active'), ($2, $3, $5, $6, $8, 'active')`,
    [
      memberId,
      secondMemberId,
      tenant,
      personId,
      secondPersonId,
      loc,
      `WLT-${RUN}`,
      `WLT2-${RUN}`,
    ],
  );
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-05 wallet ledger", () => {
  it("credits a counter top-up as a payment + ledger entry, then re-derives across 3 charges and a refund", async () => {
    const top = await wallet.topUp(ctx, {
      memberId,
      locationId: loc,
      amountPaise: 100_000,
      method: "cash",
      idempotencyKey: `top-${RUN}`,
    });
    expect(top.ok).toBe(true);
    if (!top.ok) return;
    expect(top.balanceAfterPaise).toBe(100_000);
    expect(top.replayed).toBe(false);

    // Money enters the ledger through a counter payment row, not a
    // floating credit: invoice_id null, member + location + method.
    const { rows: payRows } = await admin.query<{
      invoice_id: string | null;
      member_id: string;
      location_id: string;
      amount_paise: string;
      method: string;
      status: string;
    }>(
      "select invoice_id, member_id, location_id, amount_paise, method, status from payments where member_id = $1",
      [memberId],
    );
    expect(payRows).toHaveLength(1);
    expect(payRows[0]!.invoice_id).toBeNull();
    expect(payRows[0]!.member_id).toBe(memberId);
    expect(payRows[0]!.location_id).toBe(loc);
    expect(Number(payRows[0]!.amount_paise)).toBe(100_000);
    expect(payRows[0]!.method).toBe("cash");
    expect(payRows[0]!.status).toBe("captured");

    const charges = [10_000, 20_000, 30_000];
    for (const [index, amountPaise] of charges.entries()) {
      const charged = await wallet.charge(ctx, {
        memberId,
        amountPaise,
        sourceId: uuidv7(),
        idempotencyKey: `charge-${index}-${RUN}`,
      });
      expect(charged.ok).toBe(true);
    }

    const refunded = await wallet.refund(ctx, {
      memberId,
      amountPaise: 5_000,
      idempotencyKey: `refund-${RUN}`,
    });
    expect(refunded.ok).toBe(true);
    if (!refunded.ok) return;
    expect(refunded.balanceAfterPaise).toBe(45_000);

    // The derived balance and the stored balance_after trail agree.
    expect(await wallet.balanceOf(ctx, memberId)).toBe(45_000);

    const { rows: entries } = await admin.query<{
      direction: string;
      amount_paise: string;
      balance_after_paise: string;
    }>(
      `select direction, amount_paise::text, balance_after_paise::text
         from account_entries
        where member_id = $1
        order by created_at, id`,
      [memberId],
    );
    expect(entries).toHaveLength(5);
    let running = 0n;
    for (const entry of entries) {
      running +=
        entry.direction === "credit"
          ? BigInt(entry.amount_paise)
          : -BigInt(entry.amount_paise);
      expect(BigInt(entry.balance_after_paise)).toBe(running);
      expect(running).toBeGreaterThanOrEqual(0n);
    }
    expect(running).toBe(45_000n);

    // Every mutation is audited in-transaction under the wallet names.
    expect(await auditCount("wallet.topup")).toBe(1);
    expect(await auditCount("wallet.charge")).toBe(3);
    expect(await auditCount("wallet.refund")).toBe(1);
  });

  it("allows a debit down to exactly zero and refuses the paisa that would go negative", async () => {
    const top = await wallet.topUp(ctx, {
      memberId: secondMemberId,
      locationId: loc,
      amountPaise: 50_000,
      method: "upi",
      reference: `UPI-${RUN}`,
      idempotencyKey: `top2-${RUN}`,
    });
    expect(top.ok).toBe(true);

    const exact = await wallet.charge(ctx, {
      memberId: secondMemberId,
      amountPaise: 50_000,
      idempotencyKey: `charge-exact-${RUN}`,
    });
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(exact.balanceAfterPaise).toBe(0);

    const entriesBefore = await entryCount(secondMemberId);
    const refused = await wallet.charge(ctx, {
      memberId: secondMemberId,
      amountPaise: 1,
      idempotencyKey: `charge-over-${RUN}`,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/insufficient|balance/i);

    expect(await entryCount(secondMemberId)).toBe(entriesBefore);
    expect(await wallet.balanceOf(ctx, secondMemberId)).toBe(0);
    // 3 charges in test 1 + the exact-to-zero debit here; the refused
    // debit writes no audit row.
    expect(await auditCount("wallet.charge")).toBe(4);
  });

  it("replays a duplicate idempotency key without inserting a second payment or entry", async () => {
    const paymentsBefore = await paymentCount();
    const entriesBefore = await entryCount(memberId);

    const first = await wallet.topUp(ctx, {
      memberId,
      locationId: loc,
      amountPaise: 7_000,
      method: "card",
      reference: `TERM-${RUN}`,
      idempotencyKey: `dup-${RUN}`,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await entryCount(memberId)).toBe(entriesBefore + 1);
    expect(await paymentCount()).toBe(paymentsBefore + 1);

    const replay = await wallet.topUp(ctx, {
      memberId,
      locationId: loc,
      amountPaise: 7_000,
      method: "card",
      reference: `TERM-${RUN}`,
      idempotencyKey: `dup-${RUN}`,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.entryId).toBe(first.entryId);
    expect(replay.balanceAfterPaise).toBe(first.balanceAfterPaise);
    expect(replay.replayed).toBe(true);

    // Nothing new: no payment row, no entry, no second audit row.
    expect(await entryCount(memberId)).toBe(entriesBefore + 1);
    expect(await paymentCount()).toBe(paymentsBefore + 1);
    // top- (test 1), top2- (test 2) and dup- here; the replay adds none.
    expect(await auditCount("wallet.topup")).toBe(3);
  });

  it("another tenant reads zero rows through withTenant()", async () => {
    const countFor = (tenantId: typeof tenant) =>
      withTenant(tenantId, async (tx) => {
        const rows = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(accountEntries);
        return rows[0].n;
      });

    expect(await countFor(tenant)).toBeGreaterThan(0);
    expect(await countFor(otherTenant)).toBe(0);
  });

  it("app_user can INSERT and SELECT but cannot UPDATE or DELETE", async () => {
    async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
        return "(resolved)";
      } catch (err) {
        const e = err as { message?: string; cause?: { message?: string } };
        return `${e.message ?? ""} | ${e.cause?.message ?? ""}`;
      }
    }

    const updateMessage = await rejectionMessage(
      withTenant(tenant, (tx) =>
        tx.execute(
          sql`update account_entries set amount_paise = 1 where tenant_id = ${tenant}`,
        ),
      ),
    );
    expect(updateMessage).toMatch(/permission denied for table account_entries/);

    const deleteMessage = await rejectionMessage(
      withTenant(tenant, (tx) =>
        tx.execute(sql`delete from account_entries where tenant_id = ${tenant}`),
      ),
    );
    expect(deleteMessage).toMatch(/permission denied for table account_entries/);
  });
});
