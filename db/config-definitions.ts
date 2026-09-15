import { z } from "zod";

// O-04 (docs/ops-platform-design.md §3) — the configuration key
// catalogue. This file is the source of truth: db/seed-platform.ts
// upserts these rows into config_keys on every run, and every write is
// validated against valueSchema before it reaches the database.
//
// Adding a key is a product decision, not a code decision. The
// admission test in the design doc (four questions: two real clubs
// answer differently, behaviour not wording, a working default, a bad
// value is recoverable) is the control. Do not add a key here without
// passing it.

export type ConfigVisibility = "owner_edit" | "owner_read" | "ops_only";
export type ConfigRisk = "safe" | "sensitive" | "dangerous";

export type ConfigKeyDefinition = {
  valueSchema: z.ZodType;
  // JSON-schema-shaped mirror of valueSchema, stored in config_keys so
  // both consoles can render a key without importing the engine.
  jsonSchema: Record<string, unknown>;
  defaultValue: unknown;
  visibility: ConfigVisibility;
  risk: ConfigRisk;
  description: string;
};

export const CONFIG_KEYS = {
  "attendance.absence_alert_threshold_pct": {
    valueSchema: z.number().int().min(0).max(100),
    jsonSchema: { type: "integer", minimum: 0, maximum: 100 },
    defaultValue: 50,
    visibility: "owner_edit",
    risk: "safe",
    description:
      "The share of a member's recorded marks that can be absences before the monthly low-attendance alert fires. 0-100.",
  },
  // 2026-09-14 — the GST rate, in basis points (1800 = 18%). Plan
  // prices are GST-exclusive; invoices apply this rate at issue and
  // snapshot it. Resolution is the registry's fixed order extended with
  // activity: platform 18% -> tenant default -> facility (location)
  // -> activity, so café food can differ from sports inside one site.
  // Money semantics: ops-only.
  "billing.gst_rate_bp": {
    valueSchema: z.number().int().min(0).max(10000),
    jsonSchema: { type: "integer", minimum: 0, maximum: 10000 },
    defaultValue: 1800,
    visibility: "ops_only",
    risk: "sensitive",
    description:
      "GST rate in basis points (1800 = 18%). Inherited platform -> tenant -> facility -> activity; invoices snapshot the resolved rate.",
  },
  // C-32 — the SAC code printed on invoice lines. Services use SAC
  // (goods use HSN); 999723 is the common code for sports and
  // recreation services, but it is a default, not a legal claim — the
  // tenant's accountant confirms the right code. Snapshotted onto
  // each invoice line at issue.
  "billing.sac_code": {
    valueSchema: z.string().trim().regex(/^\d{4,8}$/),
    jsonSchema: { type: "string", pattern: "^\\d{4,8}$" },
    defaultValue: "999723",
    visibility: "ops_only",
    risk: "sensitive",
    description:
      "SAC code printed on invoice lines (4-8 digits). Default 999723 (sports and recreation services) — confirm with the tenant's accountant.",
  },
  // O-08 — location-scoped staff access. OFF is today's tenant-wide
  // behaviour. This is an access-control boundary inside one business,
  // never tenant isolation. Visibility is owner_read: owners see it
  // and ask for it through the change-request path; ops enables it.
  "access.location_scoped_staff": {
    valueSchema: z.boolean(),
    jsonSchema: { type: "boolean" },
    defaultValue: false,
    visibility: "owner_read",
    risk: "sensitive",
    description:
      "When on, staff see only the locations they are attached to. An access control inside one academy, not tenant isolation.",
  },
  // Registered now, still stored in tenants.offline_sync_enabled: a
  // human-owned tier-1 test pins that column (platform-tenants-detail),
  // so the storage migration lands when that test is updated. Reads and
  // writes must come here once it does — see O-04's PR description.
  "attendance.offline_sync_enabled": {
    valueSchema: z.boolean(),
    jsonSchema: { type: "boolean" },
    defaultValue: false,
    visibility: "ops_only",
    risk: "sensitive",
    description:
      "Kill switch for the offline attendance queue. Ops only — a tenant must not be able to disable its own write path.",
  },
} as const satisfies Record<string, ConfigKeyDefinition>;

export type ConfigKeyName = keyof typeof CONFIG_KEYS;
