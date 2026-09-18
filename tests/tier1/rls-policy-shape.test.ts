import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";

// H-02 — one RLS policy shape across tenant tables. The audit found
// eight policies still written as `tenant_id::text =
// current_setting('app.tenant_id', true)` (the shape migration
// 0004_policy_nullif_hardening.sql replaced) and seven more carrying
// the older `current_setting(...)::uuid` form. Both fail the
// empty/unset GUC case; the standard is the nullif form, which makes
// an unscoped read return zero rows instead of erroring. Written
// before db/migrations/20260918051000_h02_rls_policy_convergence.sql:
// both assertions are red until it lands.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

afterAll(async () => {
  await admin.end();
});

const NULLIF_TENANT = /nullif\s*\(\s*current_setting\('app\.tenant_id'/i;

// The eight text-shaped policies named in the H-02 audit.
const AUDITED = [
  { table: "staff_locations", policy: "staff_locations_tenant_isolation" },
  { table: "location_presets", policy: "location_presets_tenant_isolation" },
  { table: "makeup_credits", policy: "makeup_credits_tenant_isolation" },
  { table: "tenant_holidays", policy: "tenant_holidays_tenant_isolation" },
  { table: "waitlist_entries", policy: "waitlist_entries_tenant_isolation" },
  {
    table: "member_facility_optins",
    policy: "member_facility_optins_tenant_isolation",
  },
  { table: "invite_link_uses", policy: "invite_link_uses_tenant_isolation" },
  { table: "absence_alerts", policy: "absence_alerts_tenant_isolation" },
];

type PolicyRow = {
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
};

async function tenantPolicies(): Promise<PolicyRow[]> {
  const { rows } = await admin.query<PolicyRow>(
    `select tablename, policyname, qual, with_check from pg_policies
      where qual like '%app.tenant_id%' or with_check like '%app.tenant_id%'
      order by tablename, policyname`,
  );
  return rows;
}

function offenders(rows: PolicyRow[]): string[] {
  return rows.flatMap((row) => {
    const texts = [row.qual, row.with_check].filter(
      (t): t is string => t !== null,
    );
    const bad = texts.filter((t) => !NULLIF_TENANT.test(t));
    return bad.length > 0
      ? [`${row.tablename}.${row.policyname}: ${bad.join(" | ")}`]
      : [];
  });
}

describe("H-02 tenant RLS policy shape", () => {
  it("the eight audited policies exist and use the nullif-standard shape", async () => {
    const rows = await tenantPolicies();
    const missingOrBad = AUDITED.flatMap(({ table, policy }) => {
      const row = rows.find(
        (r) => r.tablename === table && r.policyname === policy,
      );
      if (!row) return [`${table}.${policy}: missing`];
      return offenders([row]).map((o) => `${table}.${policy}: ${o}`);
    });
    expect(missingOrBad).toEqual([]);
  });

  it("every policy referencing app.tenant_id uses the nullif-standard shape", async () => {
    const rows = await tenantPolicies();
    expect(rows.length).toBeGreaterThanOrEqual(AUDITED.length);
    expect(offenders(rows)).toEqual([]);
  });
});
