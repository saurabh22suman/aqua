import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// C-34 audit fix — a live-attack audit found two problems in
// confirmCashCount: (a) a second confirm for the same tenant+
// location+day silently overwrote the row (hard unique key +
// onConflictDoUpdate); the prior value survived only as a separate
// audit_log row (entity_id null), never in the table itself
// ("Fix B — closed state" below); (b) no policy gate on variance
// size at all ("Fix A — variance policy" below).
//
// This file exercises both fixes directly against Testcontainers
// Postgres, following the pattern in tests/billing-payments.test.ts.
// No payments/invoices fixtures are needed: confirmCashCount computes
// systemPaise as the sum of captured cash payments for the
// tenant+location+day, which is 0 when none exist — so countedPaise
// alone controls the variance in every scenario below, and each
// scenario uses its own onDate to stay independent.

type Reconciliation = typeof import("@/lib/services/reconciliation");
type ReconciliationClosedState = typeof import("@/lib/services/reconciliation-closed-state");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let reconciliation: Reconciliation;
let closedState: ReconciliationClosedState;

const tenantA = asTenantId(uuidv7());
const ownerUser = asUserId(uuidv7());
const receptionistUser = asUserId(uuidv7());
const locA = uuidv7();
const RUN = Date.now().toString(36);

const ownerCtx = { tenantId: tenantA, userId: ownerUser };
// Manually-constructed ctx (no DB-backed role resolution needed here
// — reconciliation.ts reads permissions straight off
// ctx.permissions, exactly what the action layer hands it after
// requireDefaultCtx() resolves the caller's role grants). No
// settings.manage — the receptionist-permission shape Fix A's
// >₹2,000 gate must refuse.
const ownerCtxWithPermissions = {
  tenantId: tenantA,
  userId: ownerUser,
  permissions: new Set(["payments.record", "settings.manage"]),
};
const receptionistCtx = {
  tenantId: tenantA,
  userId: receptionistUser,
  permissions: new Set(["payments.record"]),
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);

  reconciliation = await import("@/lib/services/reconciliation");
  closedState = await import("@/lib/services/reconciliation-closed-state");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Policy Club', 'active', 'Asia/Kolkata')",
    [tenantA, `policy-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Worli', true)",
    [locA, tenantA],
  );
  const phone = String(Date.now()).slice(-8);
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [ownerUser, `+9197${phone}`, receptionistUser, `+9198${phone}`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("Fix B — closed state", () => {
  it("blocks a second confirm on an already-closed day instead of silently overwriting it", async () => {
    const onDate = "2024-01-01";

    const first = await reconciliation.confirmCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      countedPaise: 1000,
    });
    expect(first.ok).toBe(true);

    // RED (relative to the pre-fix behaviour): before Fix B, this
    // second confirm for the same day used to succeed and silently
    // replace the row via onConflictDoUpdate. Fix B must refuse it.
    const second = await reconciliation.confirmCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      countedPaise: 5000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already closed/i);

    const { rows } = await admin.query<{ counted_paise: string; count: string }>(
      "select counted_paise::text, count(*) over ()::text as count from cash_counts where tenant_id = $1 and location_id = $2 and on_date = $3",
      [tenantA, locA, onDate],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.counted_paise).toBe("1000");
  });

  it("reopen-then-reclose leaves both the original and the new count independently visible in history", async () => {
    const onDate = "2024-01-02";

    const closed = await reconciliation.confirmCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      countedPaise: 2000,
    });
    expect(closed.ok).toBe(true);

    const blocked = await reconciliation.confirmCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      countedPaise: 3000,
    });
    expect(blocked.ok).toBe(false);

    const reopened = await closedState.reopenCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      reason: "Recount requested",
    });
    expect(reopened.ok).toBe(true);

    const recount = await reconciliation.confirmCashCount(ownerCtx, {
      locationId: locA,
      onDate,
      countedPaise: 3000,
    });
    expect(recount.ok).toBe(true);
    if (recount.ok) expect(recount.variancePaise).toBe(3000);

    // GREEN: both rows survive independently — the original close
    // (now superseded, status 'reopened') and the recount (the new
    // live 'closed' row) — not just the latest overwriting the first.
    const history = await closedState.listCashCountHistory(ownerCtx, {
      locationId: locA,
      onDate,
    });
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("reopened");
    expect(history[0]?.countedPaise).toBe(2000);
    expect(history[0]?.reopenReason).toBe("Recount requested");
    expect(history[0]?.supersededAt).not.toBeNull();
    expect(history[1]?.status).toBe("closed");
    expect(history[1]?.countedPaise).toBe(3000);
    expect(history[1]?.supersededAt).toBeNull();
  });

  it("refuses to reopen a day with no closed count", async () => {
    const result = await closedState.reopenCashCount(ownerCtx, {
      locationId: locA,
      onDate: "2024-01-03",
      reason: "Nothing to reopen",
    });
    expect(result.ok).toBe(false);
  });
});

describe("Fix A — variance policy (X = ₹500, Y = ₹2,000)", () => {
  it("closes normally, no reason required, at exactly ₹500 variance", async () => {
    const onDate = "2024-02-01";
    expect(reconciliation.REVIEW_THRESHOLD_PAISE).toBe(50_000);

    const result = await reconciliation.confirmCashCount(receptionistCtx, {
      locationId: locA,
      onDate,
      countedPaise: reconciliation.REVIEW_THRESHOLD_PAISE, // exactly ₹500
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.variancePaise).toBe(50_000);
      expect(result.needsReview).toBe(false);
    }
  });

  it("requires a reason once variance exceeds ₹500, and closes as needs-review once given", async () => {
    const onDate = "2024-02-02";
    const overReviewPaise = reconciliation.REVIEW_THRESHOLD_PAISE + 1; // ₹500.01

    // RED (relative to the pre-fix behaviour): before Fix A there was
    // no policy gate at all, so this closed silently. Now it must be
    // refused without a reason.
    const withoutReason = await reconciliation.confirmCashCount(receptionistCtx, {
      locationId: locA,
      onDate,
      countedPaise: overReviewPaise,
    });
    expect(withoutReason.ok).toBe(false);
    if (!withoutReason.ok) expect(withoutReason.error).toMatch(/₹500/);

    const withReason = await reconciliation.confirmCashCount(receptionistCtx, {
      locationId: locA,
      onDate,
      countedPaise: overReviewPaise,
      note: "Two coins uncounted at open",
    });
    expect(withReason.ok).toBe(true);
    if (withReason.ok) expect(withReason.needsReview).toBe(true);

    // GREEN — queryable as "needs review" for the owner dashboard.
    const review = await closedState.listCashCountsNeedingReview(receptionistCtx);
    expect(review.some((r) => r.onDate === onDate && r.locationId === locA)).toBe(true);

    const { rows } = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1 and entity_type = 'cash_count' and after->>'onDate' = $2 order by created_at desc limit 1",
      [tenantA, onDate],
    );
    expect(rows[0]?.action).toBe("cash_count.confirm");
  });

  it("refuses a receptionist-permission caller above ₹2,000, and requires owner permission — as its own distinct audit event", async () => {
    const onDate = "2024-02-03";
    const overOwnerPaise = reconciliation.OWNER_CLOSE_THRESHOLD_PAISE + 1; // ₹2,000.01
    expect(reconciliation.OWNER_CLOSE_THRESHOLD_PAISE).toBe(200_000);

    // RED — a receptionist-permission caller (no settings.manage)
    // must not be able to close a variance this large, even with a
    // reason supplied.
    const receptionistAttempt = await reconciliation.confirmCashCount(receptionistCtx, {
      locationId: locA,
      onDate,
      countedPaise: overOwnerPaise,
      note: "Big shortfall, need to check the register",
    });
    expect(receptionistAttempt.ok).toBe(false);
    if (!receptionistAttempt.ok) {
      expect(receptionistAttempt.error).toMatch(/₹2,000/);
    }

    const { rows: noRowYet } = await admin.query<{ count: string }>(
      "select count(*)::text as count from cash_counts where tenant_id = $1 and on_date = $2",
      [tenantA, onDate],
    );
    expect(noRowYet[0]?.count).toBe("0");

    // GREEN — an owner-permission caller can close the same variance,
    // and it's audited under a distinct action name.
    const ownerAttempt = await reconciliation.confirmCashCount(ownerCtxWithPermissions, {
      locationId: locA,
      onDate,
      countedPaise: overOwnerPaise,
      note: "Big shortfall, need to check the register",
    });
    expect(ownerAttempt.ok).toBe(true);
    if (ownerAttempt.ok) {
      expect(ownerAttempt.needsReview).toBe(true);
      expect(ownerAttempt.variancePaise).toBe(overOwnerPaise);
    }

    const { rows } = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1 and entity_type = 'cash_count' and after->>'onDate' = $2 order by created_at desc limit 1",
      [tenantA, onDate],
    );
    expect(rows[0]?.action).toBe("cash_count.confirm_over_threshold");
  });
});
