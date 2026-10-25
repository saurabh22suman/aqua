import { v7 as uuidv7 } from "uuid";
import { Pool } from "pg";
import { withTenant } from "./tenant";
import { createMember } from "@/lib/services/register";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import { recordPayment } from "@/lib/services/payments";
import { createEnquiry, addFollowUp } from "@/lib/services/enquiries";
import { createSubscription } from "@/lib/services/subscriptions";
import { setTenantConfigValue } from "./config";
import { requireMigrationUrl } from "@/lib/env";
import { asUserId, type TenantId, type UserId } from "@/lib/ids";

// Three months of club history for the seeded Splash Sports Club.
//
// The owner UX audit reviewed the owner console against a club with
// eight swimmers and almost no history — which is a fair picture of a
// fresh installation, and a useless picture of what the console looks
// like when a club is running. Every surface the owner reads is
// written here so the demo shows the FILLED state:
//
//   attendance    three months of sessions and marks (present, late,
//                 absent), including two swimmers whose attendance
//                 drifts — the cohort retention reports about;
//   money         three monthly invoices per swimmer, most paid, some
//                 outstanding, some overdue, and a payment taken
//                 today;
//   enquiries     one enquiry per funnel stage, including a follow-up
//                 that is overdue;
//   attention     a cash count with a variance, a session that started
//                 with nothing marked, overdue fees and an overdue
//                 follow-up — the four reasons "Needs you today" can
//                 have rows;
//   utilisation   the pool's opening hours, so the utilisation report
//                 has hours to measure against.
//
// Everything is SYNTHETIC. The names, phones, amounts and dates are
// invented.
//
// The seeded staff's own PIN is set by the club seeder; this module
// only writes the club's HISTORY.

const MONTHS = 3;
const MEMBERS = 30;
const SWIMMER_PRICE_PAISE = 300000; // ₹3,000 a month
const CASH_VARIANCE_PAISE = 750; // ₹7.50 over — over the ₹5 review threshold

let adminPool: Pool | null = null;

function db(): Pool {
  if (!adminPool) {
    adminPool = new Pool({ connectionString: requireMigrationUrl("db/seed-splash-history.ts") });
  }
  return adminPool;
}

export type SplashHistoryOptions = {
  tenantId: TenantId;
  locationId: string;
  batchIds: string[];
  ownerUserId: string;
  coachUserId: string;
};

export type SplashHistoryResult = {
  swimmers: number;
  sessions: number;
  attendance: number;
  invoices: number;
  payments: number;
  enquiries: number;
};

const FIRST_NAMES = [
  "Aditi", "Arjun", "Bhavya", "Chirag", "Divya", "Eshan", "Farah", "Gaurav",
  "Hana", "Ishaan", "Jaya", "Kabir", "Lavya", "Manav", "Naina", "Ojas",
  "Priya", "Rehan", "Sana", "Tara", "Uday", "Vanya", "Yash", "Zoya",
  "Advait", "Binal", "Devansh", "Ira",
];
const LAST_NAMES = [
  "Nair", "Kulkarni", "Bose", "Menon", "Chauhan", "Rao", "Dutta", "Sethi",
  "Joshi", "Khan",
];

function deterministicFraction(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function seedSplashHistory(
  options: SplashHistoryOptions,
): Promise<SplashHistoryResult> {
  const { tenantId, locationId, batchIds, ownerUserId, coachUserId } = options;
  const ctx = { tenantId, userId: asUserId(ownerUserId) };

  try {
    const swimmers = await ensureRoster(ctx, tenantId, locationId);
    // Every swimmer needs a batch: an unenrolled swimmer has no
    // sessions to attend, so no marks, no register and no lane.
    await enrolSwimmers(tenantId, batchIds, swimmers);
    const sessions = await ensureHistory(tenantId, locationId, batchIds, swimmers);
    const attendance = await ensureAttendance(tenantId, locationId, batchIds, swimmers);
    const { invoices, payments } = await ensureMoney(ctx, tenantId, locationId, swimmers);
    const enquiries = await ensureEnquiries(ctx, tenantId, locationId);
    await ensureCashCount(tenantId, locationId, coachUserId);
    await ensureBusinessHours(tenantId, locationId);

    return {
      swimmers: swimmers.length,
      sessions,
      attendance,
      invoices,
      payments,
      enquiries,
    };
  } finally {
    await adminPool?.end();
    adminPool = null;
  }
}

// Put the swimmers in the weekly batches: half in the evening squad,
// half in the morning squad, so both registers have people in them.
async function enrolSwimmers(
  tenantId: TenantId,
  batchIds: string[],
  memberIds: string[],
): Promise<void> {
  for (const [index, memberId] of memberIds.entries()) {
    const batchId = batchIds[index % batchIds.length]!;
    await db().query(
      `insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
       select gen_random_uuid(), $1, $2, $3, current_date - interval '60 days'
       where not exists (
         select 1 from enrolments
         where tenant_id = $1 and member_id = $2 and batch_id = $3
       )`,
      [tenantId, memberId, batchId],
    );
  }
}

// The roster. The club seeder writes the named swimmers; this adds the
// rest of the academy, with the joined dates spread over the three
// months (so "joined this month" has something in it, and the
// retention cohort — members here for the whole window — is real).
async function ensureRoster(
  ctx: { tenantId: TenantId; userId: UserId },
  tenantId: TenantId,
  locationId: string,
): Promise<string[]> {
  const existing = await db().query<{ id: string }>(
    "select id from members where tenant_id = $1 and deleted_at is null",
    [tenantId],
  );
  const memberIds = new Set(existing.rows.map((r) => r.id));

  const people = [
    ...FIRST_NAMES.slice(0, MEMBERS - 2).map((first, i) => ({
      first,
      last: LAST_NAMES[i % LAST_NAMES.length]!,
      // Spread the joining dates over the three months.
      joinedDaysAgo: 5 + Math.floor(i * (88 / MEMBERS)),
      status: "active" as const,
      minor: i % 5 === 0,
    })),
    // Two swimmers whose attendance drifts — the cohort the retention
    // report is about.
    { first: "Vihaan", last: "Salvi", joinedDaysAgo: 92, status: "active" as const, minor: false },
    { first: "Anaya", last: "Kamat", joinedDaysAgo: 88, status: "active" as const, minor: false },
  ];

  for (const [index, person] of people.entries()) {
    const code = `SPL-H${String(index + 1).padStart(3, "0")}`;
    const found = await db().query<{ id: string }>(
      "select id from members where tenant_id = $1 and member_code = $2",
      [tenantId, code],
    );
    if (found.rows.length > 0) {
      memberIds.add(found.rows[0].id);
      continue;
    }
    const dob = person.minor
      ? isoDaysAgo(2200 + index * 11)
      : isoDaysAgo(8000 + index * 37);
    const result = await createMember(ctx, {
      fullName: `${person.first} ${person.last}`,
      dateOfBirth: dob,
      memberCode: code,
      locationId,
      initialStatus: person.status,
      phone: `+91910000${String(1000 + index).slice(-4)}`,
      consents: [
        {
          purpose: "processing",
          policyVersion: "2026.1",
          evidence: { channel: "staff-assisted-in-person" },
        },
      ],
      ...(person.minor
        ? {
            guardian: {
              fullName: `${person.first}'s parent`,
              phone: `+91910000${String(1000 + index).slice(-4)}`,
              relationship: "parent",
            },
          }
        : {}),
    });
    if (!result.ok) {
      throw new Error(`history seed: createMember failed for ${code} — ${result.error}`);
    }
    memberIds.add(result.memberId);
    // The joined date is what the retention cohort is built from, and
    // the club seeder's members default to today.
    await db().query(
      "update members set joined_on = $2 where id = $1",
      [result.memberId, isoDaysAgo(person.joinedDaysAgo)],
    );
  }
  return [...memberIds];
}

// Three months of sessions for the batches' weekly pattern.
async function ensureHistory(
  tenantId: TenantId,
  locationId: string,
  batchIds: string[],
  memberIds: string[],
): Promise<number> {
  const days = MONTHS * 30;
  let created = 0;
  for (let d = days; d >= 0; d--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - d);
    const dateStr = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay();
    for (const batchId of batchIds) {
      const batch = await db().query<{ days_of_week: string; start_time: string }>(
        "select days_of_week::text as days_of_week, start_time from batches where id = $1 and tenant_id = $2",
        [batchId, tenantId],
      );
      const spec = batch.rows[0];
      if (!spec) continue;
      const weekdays = spec.days_of_week
        .replace(/[{}]/g, "")
        .split(",")
        .filter(Boolean)
        .map(Number);
      if (!weekdays.includes(dow)) continue;
      const existing = await db().query<{ id: string }>(
        "select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3",
        [tenantId, batchId, dateStr],
      );
      if (existing.rows.length > 0) continue;
      const endTime = addHour(spec.start_time);
      const coach = await db().query<{ coach_id: string | null }>(
        "select coach_id from batches where id = $1",
        [batchId],
      );
      await db().query(
        `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status, coach_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv7(),
          tenantId,
          batchId,
          locationId,
          dateStr,
          `${dateStr}T${spec.start_time.slice(0, 5)}:00Z`,
          `${dateStr}T${endTime.slice(0, 5)}:00Z`,
          d === 0 ? "scheduled" : "held",
          coach.rows[0]?.coach_id ?? null,
        ],
      );
      created++;
    }
  }
  void memberIds;
  return created;
}

// Marks for the sessions that have happened.
async function ensureAttendance(
  tenantId: TenantId,
  locationId: string,
  batchIds: string[],
  memberIds: string[],
): Promise<number> {
  const drifting = new Set(memberIds.slice(-2));
  const sessionRows = await db().query<{
    id: string;
    session_date: string;
    batch_id: string;
  }>(
    `select s.id, s.session_date, s.batch_id from sessions s
       join batches b on b.id = s.batch_id and b.tenant_id = s.tenant_id
      where s.tenant_id = $1 and s.status = 'held'
      order by s.session_date desc`,
    [tenantId],
  );
  let marked = 0;
  for (const session of sessionRows.rows) {
    const enrolled = await db().query<{ member_id: string }>(
      "select member_id from enrolments where tenant_id = $1 and batch_id = $2",
      [tenantId, session.batch_id],
    );
    for (const row of enrolled.rows) {
      const present = await db().query<{ id: string }>(
        "select id from attendance where session_id = $1 and member_id = $2",
        [session.id, row.member_id],
      );
      if (present.rows.length > 0) continue;
      const fraction = deterministicFraction(`${row.member_id}-${session.session_date}`);
      const isDrifting = drifting.has(row.member_id);
      const status = isDrifting
        ? fraction < 0.6
          ? "absent"
          : fraction < 0.9
            ? "present"
            : "late"
        : fraction < 0.08
          ? "late"
          : fraction < 0.18
            ? "absent"
            : "present";
      await db().query(
        `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id, marked_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date + time '07:00')`,
        [
          uuidv7(),
          tenantId,
          session.id,
          row.member_id,
          locationId,
          status,
          `seed-${session.id}-${row.member_id}`,
          session.session_date,
        ],
      );
      marked++;
    }
  }
  return marked;
}

// Three monthly invoices per swimmer, mostly paid. The rest is the
// state an owner actually has to deal with: money owed, money
// overdue, and money taken today.
async function ensureMoney(
  ctx: { tenantId: TenantId; userId: UserId },
  tenantId: TenantId,
  locationId: string,
  memberIds: string[],
): Promise<{ invoices: number; payments: number }> {
  let invoices = 0;
  let payments = 0;

  // Each swimmer is on the monthly plan, so the invoices hang off a
  // subscription and "Revenue by plan" has a plan to attribute the
  // money to. The subscription is created before the invoices — it
  // opens its own tenant scope, like recordPayment.
  const plan = await db().query<{ id: string }>(
    "select id from membership_plans where tenant_id = $1 and deleted_at is null order by name limit 1",
    [tenantId],
  );
  const planId = plan.rows[0]?.id;
  const subscriptionByMember = new Map<string, string>();
  if (planId) {
    for (const memberId of memberIds) {
      const existing = await db().query<{ id: string }>(
        `select id from subscriptions
          where tenant_id = $1 and member_id = $2 and status = 'active' limit 1`,
        [tenantId, memberId],
      );
      if (existing.rows[0]) {
        subscriptionByMember.set(memberId, existing.rows[0].id);
        continue;
      }
      const created = await createSubscription(ctx, {
        memberId,
        planId,
        startsOn: isoDaysAgo(90),
        autoRenew: true,
      });
      if (created.ok) subscriptionByMember.set(memberId, created.id);
    }
  }

  // The invoices are issued in one tenant transaction; the payments are
  // recorded after it — recordPayment opens its own tenant scope, and
  // the scope rules refuse to nest two of them.
  const toPay: Array<{ invoiceId: string; index: number }> = [];

  await withTenant(tenantId, async (tx) => {
    for (const [index, memberId] of memberIds.entries()) {
      for (let month = MONTHS - 1; month >= 0; month--) {
        // The oldest month is already overdue, the middle one was due
        // a month ago, and the newest falls due today — the spread a
        // real academy has. The dates are fixed offsets from today, so
        // a redeploy matches the invoices already there instead of
        // issuing a second set.
        const issuedOn = isoDaysAgo(month * 30 + 6);
        const dueOn = isoDaysAgo(month * 30);
        const existing = await db().query<{ id: string }>(
          `select id from invoices
            where tenant_id = $1 and member_id = $2 and issued_on = $3
            limit 1`,
          [tenantId, memberId, issuedOn],
        );
        if (existing.rows.length > 0) continue;

        const issued = await issueInvoiceInTx(
          tx,
          {
            tenantId,
            memberId,
            locationId,
            subscriptionId: subscriptionByMember.get(memberId) ?? null,
            issuedOn,
            dueOn,
            lines: [{ description: "Monthly swimming membership", amountPaise: SWIMMER_PRICE_PAISE }],
          },
          ctx.userId,
        );
        if (!issued.ok) continue;
        invoices++;

        // Most are paid. The oldest month of a few swimmers is not
        // (that is the overdue money), and the newest month of one
        // swimmer is unpaid but not yet due (that is the outstanding
        // money).
        const isOverdue = month === MONTHS - 1 && index % 4 === 0;
        const isOutstanding = month === 0 && index % 7 === 0;
        if (isOverdue || isOutstanding) continue;
        toPay.push({ invoiceId: issued.invoiceId, index });
      }
    }
  });

  // Invoices that were issued before the club had subscriptions are
  // linked now, so a redeploy repairs the history rather than leaving
  // "Revenue by plan" attributing the money to no plan at all.
  for (const [memberId, subscriptionId] of subscriptionByMember) {
    await db().query(
      `update invoices set subscription_id = $3
        where tenant_id = $1 and member_id = $2 and subscription_id is null`,
      [tenantId, memberId, subscriptionId],
    );
  }

  for (const { invoiceId, index } of toPay) {
    const paid = await recordPayment(ctx, {
      invoiceId,
      amountPaise: SWIMMER_PRICE_PAISE,
      method: index % 3 === 0 ? "upi" : "cash",
      ...(index % 3 === 0 ? { reference: `UPI${String(index).padStart(6, "0")}` } : {}),
    });
    if (!paid.ok) continue;
    payments++;
    // recordPayment stamps the payment with the current time. A club
    // that has been running for three months did not take 140
    // payments today — so each payment is moved back to the month its
    // invoice was issued in, and the collections report shows a real
    // three-month series instead of one enormous spike.
    const issuedOn = await db().query<{ issued_on: string }>(
      "select issued_on from invoices where id = $1",
      [invoiceId],
    );
    if (issuedOn.rows[0]) {
      await db().query(
        "update payments set received_at = $2::date + interval '10 hours' where id = $1",
        [paid.id, issuedOn.rows[0].issued_on],
      );
    }
  }

  // A payment taken today, so "Payments recorded today" is not zero.
  // The newest invoice that still carries a balance — a payment taken
  // today against money that is owed, which is the normal case.
  const todayInvoice = await db().query<{ id: string }>(
    `select id from invoices
      where tenant_id = $1 and status <> 'paid'
      order by issued_on desc limit 1`,
    [tenantId],
  );
  if (todayInvoice.rows[0]) {
    const already = await db().query<{ id: string }>(
      `select id from payments
        where invoice_id = $1 and received_at >= date_trunc('day', now())`,
      [todayInvoice.rows[0].id],
    );
    if (already.rows.length === 0) {
      const paid = await recordPayment(ctx, {
        invoiceId: todayInvoice.rows[0].id,
        amountPaise: SWIMMER_PRICE_PAISE,
        method: "upi",
        reference: `UPI-TODAY-${String(todayInvoice.rows[0].id).slice(0, 6)}`,
      });
      if (paid.ok) payments++;
    }
  }

  return { invoices, payments };
}

// One enquiry per funnel stage, and one follow-up that is overdue.
async function ensureEnquiries(
  ctx: { tenantId: TenantId; userId: UserId },
  tenantId: TenantId,
  locationId: string,
): Promise<number> {
  const stages = [
    { source: "walk-in", stage: "new", daysAgo: 2 },
    { source: "phone", stage: "contacted", daysAgo: 5 },
    { source: "online", stage: "trial_scheduled", daysAgo: 9 },
    { source: "referral", stage: "trial_completed", daysAgo: 16 },
    { source: "walk-in", stage: "converted", daysAgo: 24 },
    { source: "other", stage: "lost", daysAgo: 31 },
  ] as const;

  let created = 0;
  for (const [index, stage] of stages.entries()) {
    const name = `${FIRST_NAMES[(index + 4) % FIRST_NAMES.length]} ${LAST_NAMES[(index + 2) % LAST_NAMES.length]}`;
    const phone = `+91920000${String(2000 + index).slice(-4)}`;
    const found = await db().query<{ id: string }>(
      "select id from enquiries where tenant_id = $1 and phone = $2",
      [tenantId, phone],
    );
    let enquiryId = found.rows[0]?.id;
    if (!enquiryId) {
      const enquiry = await createEnquiry(ctx, {
        fullName: name,
        phone,
        source: stage.source,
        locationId,
        notes: "Interested in the evening squad.",
      });
      enquiryId = enquiry.id;
      created++;
    }
    await db().query(
      "update enquiries set stage = $2, created_at = $3::date where id = $1",
      [enquiryId, stage.stage, isoDaysAgo(stage.daysAgo)],
    );

    // The first enquiry has a follow-up that is three days overdue —
    // the reason "Needs you today" has a row.
    if (index === 0) {
      const followUp = await db().query<{ id: string }>(
        "select id from enquiry_follow_ups where enquiry_id = $1 and done_at is null",
        [enquiryId],
      );
      if (followUp.rows.length === 0) {
        await addFollowUp(ctx, {
          enquiryId,
          dueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          note: "Call back about the trial slot.",
        });
      } else {
        await db().query(
          "update enquiry_follow_ups set due_at = $2 where id = $1",
          [followUp.rows[0].id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)],
        );
      }
    }
  }
  return created;
}

// A cash count that is over by ₹7.50 — over the ₹5 threshold, so
// the reconciliation review asks the owner to look at it.
async function ensureCashCount(
  tenantId: TenantId,
  locationId: string,
  staffUserId: string,
): Promise<void> {
  const onDate = isoDaysAgo(1);
  const existing = await db().query<{ id: string }>(
    "select id from cash_counts where tenant_id = $1 and on_date = $2 and superseded_at is null",
    [tenantId, onDate],
  );
  if (existing.rows.length > 0) return;
  const staff = await db().query<{ id: string }>(
    "select id from staff where tenant_id = $1 and user_id = $2 limit 1",
    [tenantId, staffUserId],
  );
  await db().query(
    `insert into cash_counts (id, tenant_id, location_id, on_date, counted_paise, system_paise, variance_paise, note, confirmed_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      uuidv7(),
      tenantId,
      locationId,
      onDate,
      (50000 + CASH_VARIANCE_PAISE).toString(),
      "50000",
      CASH_VARIANCE_PAISE.toString(),
      "Cash counted over the system total at close.",
      staff.rows[0]?.id ?? null,
    ],
  );
}

// The pool's opening hours, so the utilisation report has hours to
// measure against instead of saying "hours unset".
async function ensureBusinessHours(
  tenantId: TenantId,
  locationId: string,
): Promise<void> {
  const days = [
    { day: "monday" as const, closed: false, open: "06:00", close: "20:00" },
    { day: "tuesday" as const, closed: false, open: "06:00", close: "20:00" },
    { day: "wednesday" as const, closed: false, open: "06:00", close: "20:00" },
    { day: "thursday" as const, closed: false, open: "06:00", close: "20:00" },
    { day: "friday" as const, closed: false, open: "06:00", close: "20:00" },
    { day: "saturday" as const, closed: false, open: "07:00", close: "13:00" },
    { day: "sunday" as const, closed: true, open: "07:00", close: "13:00" },
  ];
  const existing = await db().query<{ id: string }>(
    `select id from config_values
      where tenant_id = $1 and key = 'operations.business_hours'
        and scope_type = 'location' and scope_id = $2 and superseded_at is null
      limit 1`,
    [tenantId, locationId],
  );
  if (existing.rows.length > 0) return;
  await setTenantConfigValue({
    tenantId,
    locationId,
    key: "operations.business_hours",
    value: { days },
  });
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
