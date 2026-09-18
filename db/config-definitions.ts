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
  // U-07 — business hours. Stored on the config registry so the
  // location editor, the ops console and (later) public surfaces read
  // one source. Resolution order: platform default -> tenant ->
  // location; the editor writes location scope. An empty `days` array
  // is the honest "not configured yet" default — never invented hours.
  "operations.business_hours": {
    valueSchema: z.object({
      days: z
        .array(
          z
            .object({
              day: z.enum([
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
              ]),
              closed: z.boolean(),
              open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            })
            .refine((value) => value.closed || value.close > value.open, {
              message: "Closing time must be after opening time.",
              path: ["close"],
            }),
        )
        .max(7),
    }),
    jsonSchema: {
      type: "object",
      required: ["days"],
      properties: {
        days: {
          type: "array",
          maxItems: 7,
          items: {
            type: "object",
            required: ["day", "closed", "open", "close"],
            properties: {
              day: {
                enum: [
                  "monday",
                  "tuesday",
                  "wednesday",
                  "thursday",
                  "friday",
                  "saturday",
                  "sunday",
                ],
              },
              closed: { type: "boolean" },
              open: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              close: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
            },
          },
        },
      },
    },
    defaultValue: { days: [] },
    visibility: "owner_edit",
    risk: "safe",
    description:
      "Opening and closing times per day for a location. Empty means not configured yet.",
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
  // V-03 — how far ahead a facility booking may be made. Resolved
  // platform -> tenant -> location; the resolver refuses a start
  // beyond the window rather than silently accepting it.
  "bookings.advance_window_days": {
    valueSchema: z.number().int().min(1).max(365),
    jsonSchema: { type: "integer", minimum: 1, maximum: 365 },
    defaultValue: 30,
    visibility: "owner_edit",
    risk: "safe",
    description: "How many days ahead a facility booking can be made. Default 30.",
  },
} as const satisfies Record<string, ConfigKeyDefinition>;

export type ConfigKeyName = keyof typeof CONFIG_KEYS;
