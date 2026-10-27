import { withTenant } from "@/db/tenant";
import { auditLog } from "@/db/schema/audit";
import { asTenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { planDemoHistory } from "./plan";
import { readTenantState } from "./snapshot";
import { resolveDemoPlans } from "./plans";
import { assertDemoTenant } from "./guards";
import { reconcileDemoHistory, type Reconciliation } from "./reconcile";
import { readChartParity, type ChartParity } from "./chart-parity";
import { writePlans, writeSubscriptions, resolveSubscriptionIds } from "./write-plans";
import { writeInvoicesAndPayments } from "./write-invoices";
import { writeSessions, writeAttendance } from "./write-schedule";
import { writeEnquiries } from "./write-enquiries";
import type { WriteContext, WriteCounters, WriteExisting } from "./write-context";
import type { HistoryPlan, TenantSnapshot } from "./types";

// The writer.
//
// One transaction, one tenant, no deletes and no resets: the generator
// only ever INSERTS rows (plus one narrow repair — re-stamping the
// attendance marks the demo seed stamped with the seed run's clock).
// Every row carries a deterministic id, so a second run addresses the
// same rows and inserts nothing.
//
// The work is split by what it writes: the plans and subscriptions
// (write-plans.ts), the invoices and payments (write-invoices.ts), the
// sessions and the registers (write-schedule.ts), and the enquiries
// (write-enquiries.ts). They share ONE transaction, which is what makes
// the audit guarantee hold: every audit row is flushed at the end of
// that transaction, next to the rows it describes.
//
// Money is integer paise end to end, and every document follows the
// application's own rules: the invoice number comes from the app's
// gapless per-financial-year counter, the tax follows the tenant's
// GSTIN (no GSTIN = bill of supply = no tax), a non-cash payment
// carries a reference and cash carries none, and a payment can never
// exceed the invoice's outstanding balance.

export type ApplyOptions = {
  tenantId: string;
  /** The instant the history is anchored to. Defaults to now. */
  nowIso?: string;
  /** The tenant's local today. Defaults to the tenant's today. */
  anchorDate?: string;
  /** How many days of history to plan. Defaults to 90. */
  windowDays?: number;
  /** False = plan only; nothing is written. */
  apply: boolean;
  /** Re-stamp demo attendance marks that carry the seed run's clock. */
  restampAttendance?: boolean;
  /** Write the audit rows. On by default; a test may turn them off. */
  audit?: boolean;
};

export type InsertedCounts = WriteCounters;

export type ApplyResult = {
  tool: "aqua-demo-history";
  version: 1;
  mode: "dry-run" | "apply";
  generatedAt: string;
  tenant: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
  };
  window: HistoryPlan["window"];
  planned: HistoryPlan["totals"];
  inserted: InsertedCounts;
  existing: WriteExisting;
  restamped: { attendanceMarks: number };
  reconciliation: Reconciliation | null;
  /** The owner's own chart service against the same window. */
  chartParity: ChartParity | null;
};

const ZERO_INSERTED: InsertedCounts = {
  plans: 0,
  subscriptions: 0,
  invoices: 0,
  invoiceLines: 0,
  payments: 0,
  sessions: 0,
  marks: 0,
  enquiries: 0,
  followUps: 0,
  auditRows: 0,
};

const ZERO_EXISTING: WriteExisting = {
  plans: 0,
  subscriptions: 0,
  invoices: 0,
  payments: 0,
  sessions: 0,
  marks: 0,
  enquiries: 0,
};

export async function applyDemoHistory(
  options: ApplyOptions,
): Promise<ApplyResult> {
  const nowMs = options.nowIso ? Date.parse(options.nowIso) : Date.now();
  if (Number.isNaN(nowMs)) {
    throw new Error(`applyDemoHistory: invalid nowIso "${options.nowIso}"`);
  }
  const state = await readTenantState(options.tenantId);
  // The refusal lives here too, not only in the CLI: a programmatic
  // caller cannot reach past it.
  assertDemoTenant(state.tenant);

  const anchorDate =
    options.anchorDate ?? todayInZone(state.tenant.timezone, nowMs);
  const plans = resolveDemoPlans(state);

  const snapshot: TenantSnapshot = {
    tenantId: state.tenant.id,
    slug: state.tenant.slug,
    name: state.tenant.name,
    timezone: state.tenant.timezone,
    anchorDate,
    nowIso: new Date(nowMs).toISOString(),
    windowDays: options.windowDays ?? 90,
    primaryLocationId: state.primaryLocationId,
    members: state.members,
    batches: state.batches,
    holidays: state.holidays,
    plans,
    receiverUserId: state.receiverUserId,
  };

  const plan = planDemoHistory(snapshot);
  const base: ApplyResult = {
    tool: "aqua-demo-history",
    version: 1,
    mode: options.apply ? "apply" : "dry-run",
    generatedAt: new Date(nowMs).toISOString(),
    tenant: {
      id: state.tenant.id,
      slug: state.tenant.slug,
      name: state.tenant.name,
      timezone: state.tenant.timezone,
    },
    window: plan.window,
    planned: plan.totals,
    inserted: { ...ZERO_INSERTED },
    existing: { ...ZERO_EXISTING },
    restamped: { attendanceMarks: 0 },
    reconciliation: null,
    chartParity: null,
  };

  if (!options.apply) return base;

  const written = await withTenant(state.tenant.id, async (tx) => {
    const ctx: WriteContext = {
      tx,
      tenantId: asTenantId(state.tenant.id),
      state,
      snapshot,
      plan,
      counters: { ...ZERO_INSERTED },
      existing: { ...ZERO_EXISTING },
      audit: [],
      nowMs,
    };

    await writePlans(ctx);
    await writeSubscriptions(ctx);
    const subscriptionIds = await resolveSubscriptionIds(ctx);
    await writeInvoicesAndPayments(ctx, subscriptionIds);
    const sessionIds = await writeSessions(ctx);
    const restamped = (options.restampAttendance ?? true)
      ? await writeAttendance(ctx, sessionIds)
      : 0;
    await writeEnquiries(ctx);

    // ------------------------------------------------------------- audit
    if (options.audit ?? true) {
      for (const row of ctx.audit) {
        await tx.insert(auditLog).values({
          tenantId: ctx.tenantId,
          actorType: "system",
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          after: row.after,
          source: "job",
          createdAt: row.createdAt,
        });
        ctx.counters.auditRows += 1;
      }
      // The run-level row records what this run DID. A run that changed
      // nothing (the repeat run) leaves no trace in the audit trail.
      const changed =
        ctx.counters.plans +
        ctx.counters.subscriptions +
        ctx.counters.invoices +
        ctx.counters.payments +
        ctx.counters.sessions +
        ctx.counters.marks +
        ctx.counters.enquiries +
        ctx.counters.followUps;
      if (changed > 0) {
        await tx.insert(auditLog).values({
          tenantId: ctx.tenantId,
          actorType: "system",
          action: "seed.demo_history",
          entityType: "tenant",
          entityId: ctx.tenantId,
          after: {
            window: plan.window,
            inserted: ctx.counters,
            planned: plan.totals,
            synthetic: true,
          },
          source: "job",
          createdAt: new Date(nowMs),
        });
        ctx.counters.auditRows += 1;
      }
    }

    const reconciliation = await reconcileDemoHistory(tx, {
      tenantId: state.tenant.id,
      timezone: state.tenant.timezone,
      from: plan.window.from,
      // The money window runs up to the anchor day: the sessions stop
      // at yesterday (today's registers are marked live during the
      // walkthrough), but money collected this morning is money.
      to: anchorDate,
      today: anchorDate,
    });

    return {
      counters: ctx.counters,
      existing: ctx.existing,
      restamped,
      reconciliation,
    };
  });

  // The chart parity check runs AFTER the write transaction has closed:
  // it opens its own read transaction, and a second transaction nested
  // inside the write one would trip db/scope.ts's nest guard.
  const chartParity = await readChartParity({
    tenantId: state.tenant.id,
    nowMs,
  });

  return {
    ...base,
    inserted: written.counters,
    existing: written.existing,
    restamped: { attendanceMarks: written.restamped },
    reconciliation: written.reconciliation,
    chartParity,
  };
}
