import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// C-34 audit fix, Fix B — closed state. A live-attack audit found
// that a second confirmCashCount call for the same tenant+location+
// day silently overwrote the row (hard unique key +
// onConflictDoUpdate); the prior value survived only as a separate
// audit_log row (entity_id null), never in the table itself.
//
// This file exercises the fix directly against Testcontainers
// Postgres, following the pattern in tests/billing-payments.test.ts.
// No payments/invoices fixtures are needed: confirmCashCount computes
// systemPaise as the sum of captured cash payments for the
// tenant+location+day, which is 0 when none exist — so countedPaise
// alone controls the variance in every scenario below, and each
// scenario uses its own onDate to stay independent.
//
// Fix A (the ₹500 / ₹2,000 variance policy) is a separate commit —
// its own describe block lands in a follow-up commit on this branch.

type Reconciliation = typeof import("@/lib/services/reconciliation");
type ReconciliationClosedState = typeof import("@/lib/services/reconciliation-closed-state");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let reconciliation: Reconciliation;
let closedState: ReconciliationClosedState;

const tenantA = asTenantId(uuidv7());
const ownerUser = asUserId(uuidv7());
const locA = uuidv7();
const RUN = Date.now().toString(36);

const ownerCtx = { tenantId: tenantA, userId: ownerUser };

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
  await admin.query("insert into users (id, phone) values ($1, $2)", [ownerUser, `+9197${phone}`]);
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
