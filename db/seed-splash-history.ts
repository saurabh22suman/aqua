/**
 * Splash Sports Club — additive synthetic history (LOCAL-ONLY).
 *
 * Fills the last three complete calendar months plus the current month to
 * date (Asia/Kolkata) with realistic, uneven activity so the owner charts
 * and reports can be evaluated:
 *
 *   * a Saturday "Stroke Clinic" batch with enrolments that respect the
 *     batch capacity, completed historical sessions, and attendance that
 *     is present / late / absent — with two sessions deliberately left
 *     unmarked;
 *   * monthly membership invoices for 4 members a month — paid, partial
 *     and issued/overdue — with payments in cash, UPI, card and bank
 *     transfer on uneven days and amounts;
 *   * card and bank-transfer payments, which the existing recorded
 *     history did not have.
 *
 * It is purely additive: new rows only, deterministic UUIDs, no updates,
 * no deletes and no reads/writes outside the one tenant. It never runs
 * against production or a non-loopback database, and it refuses unless
 * explicitly opted in for the exact synthetic tenant slug:
 *
 *   SEED_SPLASH_HISTORY_TENANT=splash-sports-club
 *   SEED_SPLASH_HISTORY_APPLY=1        # omit for a dry-run summary
 *   pnpm exec tsx db/seed-splash-history.ts
 *
 * A second run inserts zero rows (every key is stable and every insert is
 * ON CONFLICT DO NOTHING).
 *
 * The base club (members, plans, staff, the two weekday batches) is NOT
 * created here; run `pnpm db:seed:splash`/the deploy seeder first. The
 * existing over-capacity totals (23 enrolled against 12/16 places) are
 * baseline data and are reported, never "fixed" by this seed.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import { withTenant } from "./tenant";
import { withPlatformAdmin } from "./scope";
import { batches, programs, sessions } from "@/db/schema";
import { members, persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { enrolments, attendance } from "@/db/schema/scheduling";
import { invoices } from "@/db/schema/invoices";
import { payments } from "@/db/schema/payments";
import { auditLog } from "@/db/schema/audit";
import { addDays, todayInZone, weekdayOf, zonedWallTimeToInstant } from "@/lib/time/tz";
import { financialYearFor } from "@/lib/invoice-numbering";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import type { PaymentMethodKey } from "@/lib/money/payment-groups";

export const SPLASH_HISTORY_SLUG = "splash-sports-club";
export const SPLASH_HISTORY_TENANT_NAME = "Splash Sports Club";
const TZ = "Asia/Kolkata";
const NAMESPACE = "9e0f6f9a-6f5b-4b0e-9f3e-2f0f0d5c7a11";
const BATCH_KEY = "saturday-stroke-clinic";

const uuidFor = (tenantId: string, key: string) => uuidv5(`${tenantId}:${key}`, NAMESPACE);
const money = (rupees: number) => rupees * 100;

export type PlannedInvoice = {
  key: string;
  invoiceNumber: string;
  memberIndex: number;
  issuedOn: string;
  dueOn: string;
  /**
   * The Indian financial year (1 April - 31 March) of THIS invoice's
   * issue date — `2026-27` for Jan-Mar 2027, `2027-28` for Apr 2027. It
   * is a property of the invoice, not of the seed run: a window that
   * crosses 31 March / 1 April carries both.
   */
  financialYear: string;
  totalPaise: number;
  paidPaise: number;
  status: "paid" | "partial" | "issued";
  payment: {
    amountPaise: number;
    method: PaymentMethodKey;
    receivedAtIso: string;
    reference: string | null;
  } | null;
};

export type PlannedSession = {
  date: string; // IST calendar date
  startIso: string;
  endIso: string;
  markedAtIso: string;
  unmarked: boolean;
};

export type HistoryPlan = {
  window: { from: string; to: string; months: string[] };
  invoices: PlannedInvoice[];
  sessions: PlannedSession[];
  batch: {
    key: string;
    name: string;
    capacity: number;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
  /** Deterministic statuses per member index for each marked session. */
  attendanceFor: (session: PlannedSession, memberIndex: number) => "present" | "late" | "absent";
};

const MONTH_KEYS = (nowIso: string): string[] => {
  // Last three complete months + the current month-to-date.
  const [year, month] = nowIso.split("-").map(Number);
  const out: string[] = [];
  for (let back = 3; back >= 0; back--) {
    const total = year * 12 + (month - 1) - back;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
};

const firstSaturdayOnOrAfter = (dateIso: string): string => {
  let date = dateIso;
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(date) === 6) return date;
    date = addDays(date, 1);
  }
  return date;
};

/**
 * Pure planner. No I/O, no clock beyond `now`, no randomness beyond a
 * fixed generator, so tests can pin every boundary.
 */
export function planSplashHistory(nowMs: number = Date.now()): HistoryPlan {
  const today = todayInZone(TZ, nowMs);
  const months = MONTH_KEYS(today);
  const from = `${months[0]}-01`;
  const invoices: PlannedInvoice[] = [];
  const methods: PaymentMethodKey[] = ["cash", "upi", "card", "bank_transfer"];
  const amountVariation = [0, money(200), -money(300), money(100)];
  const dayOffsets = [2, 9, 15, 21];

  months.forEach((month, monthIndex) => {
    dayOffsets.forEach((day, index) => {
      const issuedOn = `${month}-${String(day).padStart(2, "0")}`;
      if (issuedOn > today) return; // never issue a future invoice
      const dueOn = addDays(issuedOn, 10);
      const totalPaise = money(3000) + amountVariation[(monthIndex + index) % 4]!;
      const kind = index % 4; // 0 paid, 1 paid, 2 partial, 3 issued
      const status = kind === 2 ? "partial" : kind === 3 ? "issued" : "paid";
      const paidPaise =
        status === "paid"
          ? totalPaise
          : status === "partial"
            ? Math.round(totalPaise * (index === 2 ? 0.45 : 0.6))
            : 0;
      const method = methods[(monthIndex * 3 + index) % methods.length]!;
      const receivedOn = addDays(issuedOn, 2 + (index % 3));
      const receivedAtIso = zonedWallTimeToInstant(
        receivedOn,
        ["10:20", "12:05", "17:40", "19:15"][index % 4]!,
        TZ,
      ).toISOString();
      const withinNow = Date.parse(receivedAtIso) <= nowMs;
      const invoiceNumber = `HIST/${month.replace("-", "")}/${String(index + 1).padStart(3, "0")}`;
      const payment =
        paidPaise > 0
          ? {
              amountPaise: paidPaise,
              method,
              receivedAtIso,
              reference:
                method === "cash" ? null : `HIST-${month.replace("-", "")}-${index + 1}-${method}`,
            }
          : null;
      // A paid/partial invoice whose payment would be in the future is
      // not planned at all — no future money, no dangling balance.
      if (paidPaise > 0 && !withinNow) return;
      invoices.push({
        key: invoiceNumber,
        invoiceNumber,
        memberIndex: (monthIndex * 4 + index) % 12,
        issuedOn,
        dueOn,
        // The financial year belongs to the invoice's issue date, so a
        // window crossing 31 March / 1 April plans both years.
        financialYear: financialYearFor(issuedOn),
        totalPaise,
        paidPaise,
        status,
        payment,
      });
    });
  });

  const batch = {
    key: BATCH_KEY,
    name: "Saturday Stroke Clinic",
    capacity: 12,
    daysOfWeek: [6],
    startTime: "09:00",
    endTime: "10:00",
  };
  const plannedSessions: PlannedSession[] = [];
  let date = firstSaturdayOnOrAfter(from);
  const lastDate = today;
  while (date <= lastDate) {
    const startIso = zonedWallTimeToInstant(date, batch.startTime, TZ).toISOString();
    const endIso = zonedWallTimeToInstant(date, batch.endTime, TZ).toISOString();
    if (Date.parse(endIso) <= nowMs) {
      plannedSessions.push({
        date,
        startIso,
        endIso,
        markedAtIso: new Date(Date.parse(endIso) + 5 * 60_000).toISOString(),
        unmarked: false,
      });
    }
    date = addDays(date, 7);
  }
  // Two completed sessions stay genuinely unmarked (a register nobody
  // filled in), the rest are marked below.
  const unmarkedIndexes = new Set([2, Math.min(10, plannedSessions.length - 1)]);
  plannedSessions.forEach((session, index) => {
    session.unmarked = unmarkedIndexes.has(index);
  });

  const attendanceFor = (session: PlannedSession, memberIndex: number) => {
    // Deterministic, uneven: mostly present, some late, a few absent.
    const seed = Number(session.date.slice(8)) + memberIndex * 7;
    const bucket = seed % 10;
    if (bucket === 0) return "absent" as const;
    if (bucket <= 2) return "late" as const;
    return "present" as const;
  };

  return {
    window: { from, to: today, months },
    invoices,
    sessions: plannedSessions,
    batch,
    attendanceFor,
  };
}

export type ApplyResult = {
  inserted: {
    batch: number;
    enrolments: number;
    sessions: number;
    attendance: number;
    invoices: number;
    payments: number;
  };
  totals: {
    invoices: number;
    paymentsPaise: number;
    attendanceMarks: number;
    unmarkedSessions: number;
  };
  skipped: { reason: string; count: number }[];
};

type HistoryCtx = {
  tenantId: TenantId;
  nowMs: number;
  apply: boolean;
  /** Tests disable the run-level audit row (audit_log is append-only). */
  audit?: boolean;
};

/**
 * Applies the plan inside ONE tenant transaction. Idempotent: every row
 * uses a v5 UUID (or a natural unique key) and ON CONFLICT DO NOTHING.
 */
export async function applySplashHistory(ctx: HistoryCtx): Promise<ApplyResult> {
  const plan = planSplashHistory(ctx.nowMs);
  const result: ApplyResult = {
    inserted: { batch: 0, enrolments: 0, sessions: 0, attendance: 0, invoices: 0, payments: 0 },
    totals: {
      invoices: plan.invoices.length,
      paymentsPaise: plan.invoices.reduce((sum, inv) => sum + (inv.payment?.amountPaise ?? 0), 0),
      attendanceMarks: 0,
      unmarkedSessions: plan.sessions.filter((s) => s.unmarked).length,
    },
    skipped: [],
  };

  await withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!tenant) throw new Error("Tenant not found");

    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.isPrimary, true)))
      .limit(1);
    if (!location) throw new Error("Primary location not found");

    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.tenantId, ctx.tenantId))
      .orderBy(asc(programs.name))
      .limit(1);
    if (!program) throw new Error("No programme to attach the clinic batch to");

    const coach = await tx
      .select({ id: staff.id, userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.staffType, "coach"), isNull(staff.deletedAt)))
      .limit(1);

    const activeMembers = await tx
      .select({ id: members.id, joinedOn: members.joinedOn })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.status, "active"), isNull(members.deletedAt)))
      .orderBy(asc(members.joinedOn), asc(persons.fullName))
      .limit(plan.batch.capacity);

    const batchId = uuidFor(ctx.tenantId, `batch:${plan.batch.key}`);
    const batchInsert = await tx
      .insert(batches)
      .values({
        id: batchId,
        tenantId: ctx.tenantId,
        programId: program.id,
        locationId: location.id,
        name: plan.batch.name,
        capacity: plan.batch.capacity,
        daysOfWeek: plan.batch.daysOfWeek,
        startTime: plan.batch.startTime,
        endTime: plan.batch.endTime,
        coachId: coach[0]?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: batches.id });
    result.inserted.batch += batchInsert.length;

    const enrolled = activeMembers.slice(0, Math.min(8, plan.batch.capacity));
    if (enrolled.length === 0) {
      result.skipped.push({ reason: "no active members to enrol", count: 1 });
      return;
    }
    for (const member of enrolled) {
      const enrolledOn =
        member.joinedOn && member.joinedOn > plan.window.from
          ? member.joinedOn
          : plan.window.from;
      const inserted = await tx
        .insert(enrolments)
        .values({
          id: uuidFor(ctx.tenantId, `enrolment:${plan.batch.key}:${member.id}`),
          tenantId: ctx.tenantId,
          memberId: member.id,
          batchId,
          enrolledOn,
        })
        .onConflictDoNothing()
        .returning({ id: enrolments.id });
      result.inserted.enrolments += inserted.length;
    }

    for (const planSession of plan.sessions) {
      const sessionId = uuidFor(ctx.tenantId, `session:${plan.batch.key}:${planSession.date}`);
      const inserted = await tx
        .insert(sessions)
        .values({
          id: sessionId,
          tenantId: ctx.tenantId,
          batchId,
          locationId: location.id,
          sessionDate: planSession.date,
          startsAt: new Date(planSession.startIso),
          endsAt: new Date(planSession.endIso),
          status: "held",
          coachId: coach[0]?.id ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: sessions.id });
      result.inserted.sessions += inserted.length;
      if (planSession.unmarked) continue;

      for (let memberIndex = 0; memberIndex < enrolled.length; memberIndex++) {
        const member = enrolled[memberIndex]!;
        const status = plan.attendanceFor(planSession, memberIndex);
        const mark = await tx
          .insert(attendance)
          .values({
            id: uuidFor(ctx.tenantId, `attendance:${plan.batch.key}:${planSession.date}:${member.id}`),
            tenantId: ctx.tenantId,
            sessionId,
            memberId: member.id,
            status,
            clientId: `hist-${planSession.date}-${memberIndex}`,
            markedBy: coach[0]?.userId ?? null,
            markedAt: new Date(planSession.markedAtIso),
            locationId: location.id,
          })
          .onConflictDoNothing()
          .returning({ id: attendance.id });
        result.inserted.attendance += mark.length;
      }
    }

    // Members eligible for the invoices: prefer the enrolled ones, then
    // any other active member — invoices are membership dues, not class
    // attendance, so they do not require an enrolment.
    const invoiceMembers = activeMembers;
    for (const planInvoice of plan.invoices) {
      const member = invoiceMembers[planInvoice.memberIndex % invoiceMembers.length]!;
      const invoiceId = uuidFor(ctx.tenantId, `invoice:${planInvoice.invoiceNumber}`);
      const inserted = await tx
        .insert(invoices)
        .values({
          id: invoiceId,
          tenantId: ctx.tenantId,
          locationId: location.id,
          memberId: member.id,
          invoiceNumber: planInvoice.invoiceNumber,
          financialYear: planInvoice.financialYear,
          issuedOn: planInvoice.issuedOn,
          dueOn: planInvoice.dueOn,
          subtotalPaise: BigInt(planInvoice.totalPaise),
          taxPaise: 0n,
          totalPaise: BigInt(planInvoice.totalPaise),
          paidPaise: BigInt(planInvoice.paidPaise),
          status: planInvoice.status,
          source: "membership",
          notes: "Synthetic history (seed-splash-history)",
        })
        .onConflictDoNothing()
        .returning({ id: invoices.id });
      result.inserted.invoices += inserted.length;

      if (!planInvoice.payment) continue;
      const payment = await tx
        .insert(payments)
        .values({
          id: uuidFor(ctx.tenantId, `payment:${planInvoice.invoiceNumber}`),
          tenantId: ctx.tenantId,
          invoiceId,
          memberId: member.id,
          locationId: location.id,
          amountPaise: BigInt(planInvoice.payment.amountPaise),
          method: planInvoice.payment.method,
          channel: "counter",
          receivedAt: new Date(planInvoice.payment.receivedAtIso),
          reference: planInvoice.payment.reference,
          status: "captured",
        })
        .onConflictDoNothing()
        .returning({ id: payments.id });
      result.inserted.payments += payment.length;
    }

    const changed =
      result.inserted.batch +
      result.inserted.enrolments +
      result.inserted.sessions +
      result.inserted.attendance +
      result.inserted.invoices +
      result.inserted.payments;
    if (ctx.apply && (ctx.audit ?? true) && changed > 0) {
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorType: "system",
        action: "seed.splash_history",
        entityType: "tenant",
        entityId: ctx.tenantId,
        source: "job",
        after: { ...result.inserted, window: plan.window },
      });
    }
  });

  result.totals.attendanceMarks = result.inserted.attendance;
  return result;
}

// ---------------------------------------------------------------------------
// CLI guards
// ---------------------------------------------------------------------------

export function assertLocalDatabase(url: string, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed history: NODE_ENV=production.");
  }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing to seed history: ${host} is not loopback.`);
  }
}

/**
 * Find the synthetic tenant by slug.
 *
 * The tenant is not known yet, so there is no tenant scope to set: this
 * is the one PLATFORM read the seed needs, and it goes through
 * withPlatformAdmin() — the application pool with the platform_admin
 * SELECT policy on `tenants`. The seed therefore never needs the
 * migration superuser, and it never opens a privileged connection of
 * its own.
 */
export async function findSplashTenantBySlug(
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const [tenant] = await withPlatformAdmin(async (tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1),
  );
  return tenant ?? null;
}

async function main(): Promise<void> {
  // The application connection — the same one the app itself uses. The
  // seed writes through withTenant() and reads the one bootstrap row
  // through the platform_admin policy, so it needs no privileged
  // credential at all.
  const databaseUrl = env.DATABASE_URL;
  assertLocalDatabase(databaseUrl);

  const slug = process.env.SEED_SPLASH_HISTORY_TENANT;
  if (slug !== SPLASH_HISTORY_SLUG) {
    throw new Error(
      `Refusing to seed history: set SEED_SPLASH_HISTORY_TENANT=${SPLASH_HISTORY_SLUG} (got ${slug ?? "unset"}).`,
    );
  }
  const apply = process.env.SEED_SPLASH_HISTORY_APPLY === "1";

  const tenant = await findSplashTenantBySlug(slug);
  if (!tenant) throw new Error(`Tenant ${slug} not found`);
  if (tenant.name !== SPLASH_HISTORY_TENANT_NAME) {
    throw new Error(
      `Refusing to seed history: tenant ${slug} is named ${tenant.name}, expected ${SPLASH_HISTORY_TENANT_NAME}.`,
    );
  }

  const plan = planSplashHistory();
  const byMonth = plan.invoices.reduce<Record<string, { n: number; paise: number }>>((acc, invoice) => {
    const month = invoice.issuedOn.slice(0, 7);
    acc[month] ??= { n: 0, paise: 0 };
    acc[month]!.n += 1;
    acc[month]!.paise += invoice.payment?.amountPaise ?? 0;
    return acc;
  }, {});
  const byMethod = plan.invoices.reduce<Record<string, number>>((acc, invoice) => {
    const method = invoice.payment?.method;
    if (method) acc[method] = (acc[method] ?? 0) + invoice.payment!.amountPaise;
    return acc;
  }, {});

  console.log(`Splash history ${apply ? "APPLY" : "DRY RUN"} — tenant ${tenant.name} (${slug})`);
  console.log(`Window: ${plan.window.from} .. ${plan.window.to} (${plan.window.months.join(", ")}) IST`);
  console.log(
    `Invoices: ${plan.invoices.length} (paid/partial/issued), payments by month: ${JSON.stringify(byMonth)}`,
  );
  console.log(`Payments by method (paise): ${JSON.stringify(byMethod)}`);
  console.log(
    `Clinic sessions: ${plan.sessions.length} (unmarked: ${plan.sessions.filter((s) => s.unmarked).length}), enrolments up to 8/${plan.batch.capacity}`,
  );
  if (!apply) {
    console.log("Dry run only. Set SEED_SPLASH_HISTORY_APPLY=1 to write.");
    return;
  }

  const result = await applySplashHistory({
    tenantId: asTenantId(tenant.id),
    nowMs: Date.now(),
    apply: true,
  });
  console.log(`Inserted: ${JSON.stringify(result.inserted)}`);
  console.log(`Unmarked sessions: ${result.totals.unmarkedSessions}`);
}

const isCli = process.argv[1]?.endsWith("seed-splash-history.ts");
if (isCli) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
