import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { planShapeSchema } from "@/db/preset-definitions";
import { withTenant } from "@/db/tenant";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import { addDays, todayInZone } from "@/lib/time/tz";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// M-06 — pricing model extension. First run is deliberately red: the
// widened check constraints and the service validation do not exist.
// Fixtures go through the privileged pool; every app operation goes
// through withTenant()/the services, so the billing paths are real.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenantId = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const locationId = uuidv7();
const activityId = uuidv7();
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId, userId: actor };

let plans: typeof import("@/lib/services/membership-plans");
let subs: typeof import("@/lib/services/subscriptions");

beforeAll(async () => {
  plans = await import("@/lib/services/membership-plans");
  subs = await import("@/lib/services/subscriptions");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Pricing Models', 'active', $3)`,
    [tenantId, `m06-${RUN}`, TZ],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9195${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity, activity_type_key)
     values ($1, $2, $3, 'Main court', 'court', 4, 'tennis')`,
    [activityId, tenantId, locationId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Pricing Member')",
    [personId, tenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberId, tenantId, personId, locationId, `PM-${RUN}`],
  );
}, 60_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from invoice_line_items where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from subscriptions where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from plan_shapes where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from facilities where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  await admin.query("delete from users where id = $1::uuid", [actor]);
  await admin.end();
});

describe("M-06 pricing model extension", () => {
  it("parses the new preset plan-shape kinds and keeps the old ones", () => {
    for (const shape of [
      { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
      { name: "10-pack", kind: "sessions", sessions: 10, amountPaise: null },
      { name: "Autumn term", kind: "term", durationDays: 90, amountPaise: null },
      { name: "Drop-in", kind: "drop_in", amountPaise: null },
      { name: "Per session", kind: "per_session", amountPaise: null },
    ]) {
      expect(
        planShapeSchema.safeParse(shape).success,
        `shape ${shape.kind} must parse`,
      ).toBe(true);
    }

    expect(
      planShapeSchema.safeParse({
        name: "Bad term",
        kind: "term",
        amountPaise: null,
      }).success,
    ).toBe(false);
    expect(
      planShapeSchema.safeParse({
        name: "Bad drop-in",
        kind: "drop_in",
        sessions: 1,
        amountPaise: null,
      }).success,
    ).toBe(false);
  });

  it("accepts the new kinds in the plan_shapes table and rejects unknown kinds", async () => {
    for (const [kind, durationDays, sessions] of [
      ["term", 90, null],
      ["drop_in", null, null],
      ["per_session", null, null],
    ] as const) {
      await admin.query(
        `insert into plan_shapes (id, tenant_id, name, kind, duration_days, sessions, is_sample)
         values ($1, $2, $3, $4, $5, $6, true)`,
        [uuidv7(), tenantId, `${kind} shape`, kind, durationDays, sessions],
      );
    }
    await expect(
      admin.query(
        `insert into plan_shapes (id, tenant_id, name, kind, is_sample)
         values ($1, $2, 'Nope', 'monthly', true)`,
        [uuidv7(), tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("creates term, drop-in and per-session plans for the same activity", async () => {
    const term = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Autumn term",
      kind: "term",
      durationDays: 60,
      amountPaise: 500_000,
    });
    expect(term.ok).toBe(true);

    const dropIn = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Drop-in",
      kind: "drop_in",
      amountPaise: 30_000,
    });
    expect(dropIn.ok).toBe(true);

    const perSession = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Per session",
      kind: "per_session",
      amountPaise: 20_000,
    });
    expect(perSession.ok).toBe(true);

    // Existing kinds stay valid.
    const duration = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Monthly",
      kind: "duration",
      durationDays: 30,
      amountPaise: 250_000,
    });
    expect(duration.ok).toBe(true);

    const listed = await plans.listPlans(ctx, { activityId });
    const kinds = listed.map((p) => p.kind).sort();
    expect(kinds).toEqual(["drop_in", "duration", "per_session", "term"]);
  });

  it("refuses a plan whose payload doesn't match its kind", async () => {
    const termNoDays = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Broken term",
      kind: "term",
      amountPaise: 100_000,
    });
    expect(termNoDays.ok).toBe(false);

    const dropInWithSessions = await plans.createPlan(ctx, {
      locationId,
      activityId,
      name: "Broken drop-in",
      kind: "drop_in",
      sessions: 1,
      amountPaise: 100_000,
    });
    expect(dropInWithSessions.ok).toBe(false);
  });

  it("bills a term plan through C-30 subscriptions", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from membership_plans where tenant_id = $1 and name = 'Autumn term'",
      [tenantId],
    );
    const planId = rows[0]!.id;

    const result = await subs.createSubscription(ctx, { memberId, planId });
    expect(result.ok).toBe(true);

    const list = await subs.listMemberSubscriptions(ctx, memberId);
    const created = list.find((s) => s.planId === planId);
    const today = todayInZone(TZ);
    expect(created?.startsOn).toBe(today);
    expect(created?.endsOn).toBe(addDays(today, 59));
  });

  it("bills a drop-in through C-32 invoices while the term subscription stands", async () => {
    const { rows } = await admin.query<{ id: string; amount_paise: string }>(
      "select id, amount_paise from membership_plans where tenant_id = $1 and name = 'Drop-in'",
      [tenantId],
    );
    const planId = rows[0]!.id;
    const amountPaise = Number(rows[0]!.amount_paise);

    // Subscriptions refuse drop-ins exactly like one-time purchases —
    // their billing path is an invoice, not a duration.
    const refused = await subs.createSubscription(ctx, { memberId, planId });
    expect(refused.ok).toBe(false);

    const today = todayInZone(TZ);
    const invoice = await withTenant(tenantId, (tx) =>
      issueInvoiceInTx(
        tx,
        {
          tenantId,
          memberId,
          locationId,
          issuedOn: today,
          dueOn: today,
          source: "membership",
          lines: [
            {
              description: "Drop-in court session",
              amountPaise,
              activityId,
            },
          ],
        },
        actor,
      ),
    );
    expect(invoice.ok).toBe(true);
    if (!invoice.ok) return;

    const standing = await subs.listMemberSubscriptions(ctx, memberId);
    expect(standing.some((s) => s.status === "active")).toBe(true);
  });
});
