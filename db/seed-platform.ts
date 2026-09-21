import { Client } from "pg";
import { v7 as uuidv7 } from "uuid";
import {
  SWIMMING_PRESET_DEFINITION,
  MULTI_SPORT_PRESET_DEFINITION,
} from "./preset-definitions";
import {
  BADMINTON_PRESET_DEFINITION,
  DANCE_MA_PRESET_DEFINITION,
  FOOTBALL_PRESET_DEFINITION,
  GYM_PRESET_DEFINITION,
START_FROM_SCRATCH_PRESET_DEFINITION,
} from "./preset-definitions-r22";
import { CONFIG_KEYS } from "./config-definitions";

// Phase 2.1 — preset catalogue seed entries. Authored as
// constants in db/preset-definitions.ts and
// db/preset-definitions-r22.ts (Zod-validated at module
// load, so a typo here surfaces as a build error rather than a
// runtime surprise). The seedPlatformCatalogue function below
// inserts the rows on a fresh database; production onboarding
// reads them via the applyPreset engine in 2.2.
//
// L2 — the catalogue ships ALL seven v1 definitions. The audit
// found that five of the seven (start-from-scratch, badminton,
// gym, football, dance / martial arts) were defined in source
// but not registered; the table only held swimming + multi-sport.
// Written-and-tested is not shipped — the test in
// tests/tier1/preset-catalogue-coverage.test.ts asserts the
// presets table contains every *_PRESET_DEFINITION exported
// from db/preset-definitions*.ts.
// Exported so scripts/build-catalogue-migration.ts and the catalogue-
// parity test can read the same array the seed uses.
export const PRESETS: ReadonlyArray<{
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
  // ---- R.22: five additional v1 presets ----
  // No vertical-specific content (programs / skill levels / facilities /
  // example batches all empty). Provides the five standard plan shapes
  // only; the operator adds the sport(s) from the catalogue after
  // onboarding. Distinct from multi-sport: this one ships the GA
  // features common to every club — nothing more, nothing less.
  {
    key: "start-from-scratch",
    version: 1,
    name: "Start from scratch",
    description:
      "Empty catalogue: GA features only, no programs, no skill ladder, " +
      "no facilities. The operator configures everything from scratch " +
      "during onboarding; the two standard plan shapes stay so a fresh " +
      "tenant can move from trial to active without re-seed.",
    definition: START_FROM_SCRATCH_PRESET_DEFINITION,
    status: "active",
  },
  {
    key: "badminton",
    version: 1,
    name: "Badminton / racquet",
    description:
      "Court booking + drop-in and monthly plan shapes. Junior and adult " +
      "coaching programs. Vocabulary overridden: session → match, " +
      "facility → court, batch → session.",
    definition: BADMINTON_PRESET_DEFINITION,
    status: "active",
  },
  {
    key: "gym",
    version: 1,
    name: "Gym / fitness",
    description:
      "Class booking + drop-in and monthly plan shapes. Strength and " +
      "cardio programs. Vocabulary overridden: coach → trainer, " +
      "facility → studio, session → class, batch → slot.",
    definition: GYM_PRESET_DEFINITION,
    status: "active",
  },
  {
    key: "football",
    version: 1,
    name: "Football",
    description:
      "Pitch booking + termly plan shape. Junior academy and adult " +
      "skills programs. Vocabulary overridden: member → player, " +
      "facility → pitch, batch → squad.",
    definition: FOOTBALL_PRESET_DEFINITION,
    status: "active",
  },
  {
    key: "dance-ma",
    version: 1,
    name: "Dance / martial arts",
    description:
      "Studio booking + termly plan shape. Ballet and Karate programs. " +
      "Single skill ladder (Belt). Vocabulary overridden: member → " +
      "student, coach → instructor, facility → studio, session → class, " +
      "program → style.",
    definition: DANCE_MA_PRESET_DEFINITION,
    status: "active",
  },
];

// M-01 — the platform activity-type catalogue. Migration
// 20260918120000_m01_activity_types.sql inserts the same rows (the
// production deploy path never runs this seed script); keeping the
// constants here is what makes the parity test able to compare both
// copies. Capabilities gate UI, never data integrity.
export const ACTIVITY_TYPES: ReadonlyArray<{
  key: string;
  name: string;
  capabilities: {
    bookable: boolean;
    attendance: boolean;
    progress: boolean;
    resource_based: boolean;
    pos: boolean;
  };
  sortOrder: number;
  status: "active" | "deprecated";
}> = [
  {
    key: "swimming",
    name: "Swimming",
    capabilities: {
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    },
    sortOrder: 1,
    status: "active",
  },
  {
    key: "tennis",
    name: "Tennis",
    capabilities: {
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    },
    sortOrder: 2,
    status: "active",
  },
  {
    key: "fitness",
    name: "Fitness",
    capabilities: {
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: false,
      pos: false,
    },
    sortOrder: 3,
    status: "active",
  },
  {
    key: "team_sport",
    name: "Team sport",
    capabilities: {
      bookable: false,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    },
    sortOrder: 4,
    status: "active",
  },
  {
    key: "cafe",
    name: "Café",
    capabilities: {
      bookable: false,
      attendance: false,
      progress: false,
      resource_based: false,
      pos: true,
    },
    sortOrder: 5,
    status: "active",
  },
];

// M-04 — the module registry seed. Migration
// 20260918122000_m04_module_registry.sql inserts the same rows for the
// deploy path; every declared preset/config/feature key here is
// resolved by the M-04 contract test against the real registry tables.
export const MODULES: ReadonlyArray<{
  key: string;
  name: string;
  version: number;
  status: "ga" | "beta" | "internal" | "retired";
  capabilities: {
    bookable: boolean;
    attendance: boolean;
    progress: boolean;
    resource_based: boolean;
    pos: boolean;
  };
  presetKeys: string[];
  configKeys: string[];
  featureKeys: string[];
}> = [
  {
    key: "swimming",
    name: "Swimming",
    version: 1,
    status: "ga",
    capabilities: {
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    },
    presetKeys: ["swimming"],
    configKeys: ["billing.gst_rate_bp"],
    featureKeys: ["members", "attendance", "pool.booking", "swim.levels"],
  },
  {
    key: "cafe",
    name: "Café",
    version: 1,
    status: "beta",
    capabilities: {
      bookable: false,
      attendance: false,
      progress: false,
      resource_based: false,
      pos: true,
    },
    presetKeys: [],
    configKeys: ["billing.gst_rate_bp", "billing.sac_code"],
    featureKeys: ["cafe.pos"],
  },
];

// Exported so scripts/build-catalogue-migration.ts (which produces
// db/migrations/<timestamp>_reference_catalogue.sql) and any future
// catalogue-parity test can read the same array the seed uses.
export const FEATURES: ReadonlyArray<{
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
  // PR1-C7 — the pilot's messaging provider is the mock. 'ga' claimed
  // a customer-facing feature that does not exist; 'internal' matches
  // what ships. The real WhatsApp Cloud path is documented post-pilot
  // in docs/messaging-post-pilot.md.
  { key: "messaging", name: "WhatsApp and email", category: "comms", status: "internal" },
  // Facility booking is one feature key per primary facility type.
  // pool.booking is GA today (it was added with F-01); the other three
  // are forward-looking — Phase 3 (project-scope §5.7) builds the
  // actual booking module per facility. Listed at status="beta" so
  // they exist on every preset that names them (FK target — without
  // these rows, applyPreset rolls back when a preset's
  // features[] references e.g. pitch.booking) and so the plan
  // entitlement layer can find them when V-XX ships.
  { key: "pool.booking", name: "Swimming lane booking", category: "facility", status: "ga" },
  { key: "court.booking", name: "Badminton / racquet court booking", category: "facility", status: "beta" },
  { key: "pitch.booking", name: "Football pitch booking", category: "facility", status: "beta" },
  { key: "studio.booking", name: "Studio / dance booking", category: "facility", status: "beta" },
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
  { key: "members.read.assigned", module: "members", description: "View only members assigned to the coach's own batches" },
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
  { key: "payments.refund", module: "billing", description: "Reverse a recorded payment" },
  { key: "staff.read", module: "staff", description: "View staff records" },
  { key: "staff.write", module: "staff", description: "Create and edit staff records" },
  { key: "staff.invite", module: "staff", description: "Invite a staff member to the tenant" },
  { key: "staff.attendance", module: "staff", description: "Mark staff attendance" },
  { key: "staff.roster", module: "staff", description: "View and edit the staff roster" },
  { key: "staff.self", module: "staff", description: "View own roster, mark own attendance and request own leave" },
  { key: "staff.pay.read", module: "staff", description: "View staff pay and earnings" },
  { key: "staff.pay.write", module: "staff", description: "Set staff pay rates and record payouts" },
  { key: "reports.operational", module: "reports", description: "View attendance and utilisation reports" },
  { key: "dashboard.view", module: "reports", description: "View the owner dashboard (tenant + daily-operations roll-up)" },
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

    // M-01 — re-assert the activity-type catalogue. The migration
    // seeds the same rows so `pnpm db:deploy` alone is correct; this
    // upsert keeps a local/dev seed from drifting after an edit to
    // ACTIVITY_TYPES (names and capability flags are code).
    for (const activityType of ACTIVITY_TYPES) {
      await client.query(
        `insert into activity_types (key, name, capabilities, sort_order, status)
         values ($1, $2, $3::jsonb, $4, $5)
         on conflict (key) do update
           set name = excluded.name,
               capabilities = excluded.capabilities,
               sort_order = excluded.sort_order,
               status = excluded.status,
               updated_at = now()`,
        [
          activityType.key,
          activityType.name,
          JSON.stringify(activityType.capabilities),
          activityType.sortOrder,
          activityType.status,
        ],
      );
    }

    // M-04 — re-assert the module registry. Same rationale as
    // ACTIVITY_TYPES above: the migration is the deploy path, this
    // upsert is the dev/test source of truth.
    for (const mod of MODULES) {
      await client.query(
        `insert into modules
           (key, name, version, status, capabilities, preset_keys, config_keys, feature_keys)
         values ($1, $2, $3, $4, $5::jsonb, $6::text[], $7::text[], $8::text[])
         on conflict (key) do update
           set name = excluded.name,
               version = excluded.version,
               status = excluded.status,
               capabilities = excluded.capabilities,
               preset_keys = excluded.preset_keys,
               config_keys = excluded.config_keys,
               feature_keys = excluded.feature_keys,
               updated_at = now()`,
        [
          mod.key,
          mod.name,
          mod.version,
          mod.status,
          JSON.stringify(mod.capabilities),
          mod.presetKeys,
          mod.configKeys,
          mod.featureKeys,
        ],
      );
    }

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

    // Phase 2.1 — preset catalogue. The schema is fixed by
    // migration 0007; this seed populates v1 of the two presets
    // the work-guide ships today (swimming + multi-sport). Each
    // call is idempotent on the (key, version) PK, so re-running
    // seedPlatformCatalogue against an already-seeded database is
    // a no-op. New presets or new versions land via future
    // migration-style additions; we do not extend this array.
    //
    // ON CONFLICT DO UPDATE on definition: differs from the
    // architecture's "applied once, then inert" rule. That rule
    // applies to *tenants* (a tenant with the preset applied isn't
    // reseeded). The seed populating the *catalogue* row is a
    // different question — here, a definition-shape change during
    // Phase 2 development (e.g. Phase 2.2a's `programName` field
    // on exampleBatches) needs to overwrite v1 of the catalogue.
    // New versions go via fresh rows, not by mutating v1 in place.
    for (const preset of PRESETS) {
      await client.query(
        `insert into presets (key, version, name, description, definition, status)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict (key, version) do update
           set name = excluded.name,
               description = excluded.description,
               definition = excluded.definition,
               status = excluded.status`,
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

    // O-04 — the configuration key catalogue. Code is the source of
    // truth (db/config-definitions.ts); this upsert re-asserts it on
    // every seed run, so a description or schema change ships with the
    // code that reads it. Values for a key live in config_values, never
    // here.
    for (const [key, definition] of Object.entries(CONFIG_KEYS)) {
      await client.query(
        `insert into config_keys (key, value_schema, default_value, visibility, risk, description)
         values ($1, $2::jsonb, $3::jsonb, $4, $5, $6)
         on conflict (key) do update
           set value_schema = excluded.value_schema,
               default_value = excluded.default_value,
               visibility = excluded.visibility,
               risk = excluded.risk,
               description = excluded.description,
               updated_at = now()`,
        [
          key,
          JSON.stringify(definition.jsonSchema),
          JSON.stringify(definition.defaultValue),
          definition.visibility,
          definition.risk,
          definition.description,
        ],
      );
    }

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
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const { requireMigrationUrl } = await import("@/lib/env");
  await seedPlatformCatalogue(requireMigrationUrl("db/seed-platform.ts"));
  console.log("platform catalogue seeded.");
}

if (process.argv[1] && process.argv[1].endsWith("seed-platform.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
