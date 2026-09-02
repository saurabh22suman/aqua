import { Client } from "pg";
import { v7 as uuidv7 } from "uuid";
import {
  SWIMMING_PRESET_DEFINITION,
  MULTI_SPORT_PRESET_DEFINITION,
} from "./preset-definitions";

// Phase 2.1 — preset catalogue seed entries. Authored as
// constants in db/preset-definitions.ts (Zod-validated at module
// load, so a typo here surfaces as a build error rather than a
// runtime surprise). The seedPlatformCatalogue function below
// inserts the rows on a fresh database; production onboarding
// reads them via the applyPreset engine in 2.2.
const PRESETS: ReadonlyArray<{
  key: string;
  version: number;
  name: string;
  description: string;
  definition: object;
  status: "active";
}> = [
  {
    key: "swimming",
    version: 1,
    name: "Swimming academy",
    description:
      "Aqua + lane booking + skill levels. Three swim-stroke programs, " +
      "Beginner/Intermediate/Advanced ladder with rubrics, monthly and " +
      "quarterly plan shapes, four-lane pool facility.",
    definition: SWIMMING_PRESET_DEFINITION,
    status: "active",
  },
  {
    key: "multi-sport",
    version: 1,
    name: "Multi-sport club",
    description:
      "All program modules and multiple facilities, no vertical-specific " +
      "content. Operator adds the sport(s) from the catalogue after " +
      "onboarding; we provide the empty shell and the standard plan shapes.",
    definition: MULTI_SPORT_PRESET_DEFINITION,
    status: "active",
  },
];

const FEATURES: ReadonlyArray<{
  key: string;
  name: string;
  category: string;
  status: "ga" | "beta" | "internal";
}> = [
  { key: "members", name: "Members", category: "core", status: "ga" },
  { key: "attendance", name: "Attendance", category: "core", status: "ga" },
  { key: "programs", name: "Programs and batches", category: "core", status: "ga" },
  { key: "enquiries", name: "Enquiries and trials", category: "growth", status: "ga" },
  { key: "billing", name: "Invoicing and payments", category: "money", status: "ga" },
  { key: "staff", name: "Staff", category: "staff", status: "ga" },
  { key: "reports", name: "Reports", category: "insight", status: "ga" },
  { key: "settings", name: "Settings and configuration", category: "platform", status: "ga" },
  { key: "messaging", name: "WhatsApp and email", category: "comms", status: "ga" },
  { key: "pool.booking", name: "Facility booking", category: "facility", status: "ga" },
  { key: "swim.levels", name: "Swimming skill levels", category: "vertical", status: "ga" },
  { key: "cafe.pos", name: "Café POS", category: "commerce", status: "internal" },
  { key: "analytics.advanced", name: "Advanced analytics", category: "insight", status: "internal" },
];

// The closed platform permission list. Invariant: every `module` value is
// an F-01 feature key — that is the explicit feature mapping that
// resolution (b) depends on. NOTE: the F-04 task text says "29 rows" but
// lists 30; the list below is the verbatim list, all 30 rows.
export const PERMISSIONS: ReadonlyArray<{
  key: string;
  module: string;
  description: string;
}> = [
  { key: "members.read", module: "members", description: "View member records" },
  { key: "members.write", module: "members", description: "Create and edit member records" },
  { key: "members.delete", module: "members", description: "Archive member records" },
  { key: "attendance.read", module: "attendance", description: "View attendance registers" },
  { key: "attendance.mark", module: "attendance", description: "Mark and correct attendance" },
  { key: "programs.read", module: "programs", description: "View programs and batches" },
  { key: "programs.write", module: "programs", description: "Create and edit programs and batches" },
  { key: "enquiries.read", module: "enquiries", description: "View enquiries and trials" },
  { key: "enquiries.write", module: "enquiries", description: "Create and progress enquiries and trials" },
  { key: "invoices.read", module: "billing", description: "View invoices" },
  { key: "invoices.write", module: "billing", description: "Raise and edit invoices" },
  { key: "payments.read", module: "billing", description: "View payments" },
  { key: "payments.record", module: "billing", description: "Record a payment against an invoice" },
  { key: "staff.read", module: "staff", description: "View staff records" },
  { key: "staff.write", module: "staff", description: "Create and edit staff records" },
  { key: "staff.invite", module: "staff", description: "Invite a staff member to the tenant" },
  { key: "staff.attendance", module: "staff", description: "Mark staff attendance" },
  { key: "staff.roster", module: "staff", description: "View and edit the staff roster" },
  { key: "staff.pay.read", module: "staff", description: "View staff pay and earnings" },
  { key: "staff.pay.write", module: "staff", description: "Set staff pay rates and record payouts" },
  { key: "reports.operational", module: "reports", description: "View attendance and utilisation reports" },
  { key: "reports.financial", module: "reports", description: "View revenue, cost and profitability reports" },
  { key: "settings.read", module: "settings", description: "View tenant settings" },
  { key: "settings.manage", module: "settings", description: "Change tenant settings, branding and terminology" },
  { key: "messaging.send", module: "messaging", description: "Send WhatsApp and email messages" },
  { key: "messaging.templates", module: "messaging", description: "Create and edit message templates" },
  { key: "bookings.read", module: "pool.booking", description: "View facility bookings" },
  { key: "bookings.write", module: "pool.booking", description: "Create and cancel facility bookings" },
  { key: "levels.read", module: "swim.levels", description: "View skill levels and assessments" },
  { key: "levels.assess", module: "swim.levels", description: "Record a skill assessment" },
];

export async function seedPermissions(
  connectionString: string,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const p of PERMISSIONS) {
      await client.query(
        `insert into permissions (key, module, description)
         values ($1, $2, $3)
         on conflict (key) do update
           set module = excluded.module,
               description = excluded.description`,
        [p.key, p.module, p.description],
      );
    }
  } finally {
    await client.end();
  }
}

export async function defaultPlanId(connectionString: string): Promise<string> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string }>(
      "select id from plans where is_default = true",
    );
    if (rows.length !== 1) {
      throw new Error(
        `defaultPlanId: expected exactly one default plan, found ${rows.length}`,
      );
    }
    return rows[0].id;
  } finally {
    await client.end();
  }
}

export async function seedPlatformCatalogue(
  connectionString: string,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const f of FEATURES) {
      await client.query(
        `insert into features (key, name, category, status)
         values ($1, $2, $3, $4)
         on conflict (key) do update
           set name = excluded.name,
               category = excluded.category,
               status = excluded.status`,
        [f.key, f.name, f.category, f.status],
      );
    }

    await seedPermissions(connectionString);

    // price_paise stays NULL: the pricing-model decision (scope §2.5) is
    // deliberately not encoded here. Never seed a price.
    await client.query(
      `insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)
       values ($1, 'standard', 'Standard', 'active', null, 'INR', true, 0)
       on conflict (key) do update
         set name = excluded.name,
             status = excluded.status,
             price_paise = null,
             currency = excluded.currency,
             is_default = excluded.is_default,
             sort_order = excluded.sort_order,
             updated_at = now()`,
      [uuidv7()],
    );

    // mechanical rule: every ga feature, empty limits. The internal
    // features are catalogued but unplanned — a maturity gate, not a tier.
    await client.query(
      `insert into plan_features (plan_id, feature_key, limits)
       select p.id, f.key, '{}'::jsonb
       from plans p
       cross join features f
       where p.key = 'standard' and f.status = 'ga'
       on conflict do nothing`,
    );

    await client.query(
      `update tenants
       set plan_id = (select id from plans where key = 'standard')
       where plan_id is null`,
    );

    // Platform-level (C-05): every consent row references a
    // policy_versions row by version -- an immutable text snapshot, not
    // just a label. Placeholder content until a real privacy notice is
    // drafted; the point right now is that the FK target exists and the
    // shape is real, not that this specific text is final.
    await client.query(
      `insert into policy_versions (version, content)
       values ($1, $2)
       on conflict (version) do nothing`,
      [
        "2026.1",
        "Placeholder consent notice — replace with the real DPDP-compliant privacy notice before go-live.",
      ],
    );

    // Phase 2.1 — preset catalogue. The schema is fixed by
    // migration 0007; this seed populates v1 of the two presets
    // the work-guide ships today (swimming + multi-sport). Each
    // call is idempotent on the (key, version) PK, so re-running
    // seedPlatformCatalogue against an already-seeded database is
    // a no-op. New presets or new versions land via future
    // migration-style additions; we do not extend this array.
    for (const preset of PRESETS) {
      await client.query(
        `insert into presets (key, version, name, description, definition, status)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict (key, version) do nothing`,
        [
          preset.key,
          preset.version,
          preset.name,
          preset.description,
          JSON.stringify(preset.definition),
          preset.status,
        ],
      );
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const { env } = await import("@/lib/env");
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
  console.log("platform catalogue seeded.");
}

if (process.argv[1] && process.argv[1].endsWith("seed-platform.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
