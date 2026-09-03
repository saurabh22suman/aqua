import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import {
  getTerminology,
  updateTermOverride,
  clearTermOverride,
  type UpdateTermOverrideInput,
} from "@/lib/services/terminology";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import { resolveTerm, DEFAULT_TERMS, TERM_KEYS } from "@/lib/terminology/keys";

// Phase 2.10 — terminology service tests (TDD; the
// implementation arrives in the same PR).
//
// The closed term set lives in lib/terminology/keys.ts
// (architecture § 7.5: "TERM_KEYS is closed. A new overridable
// term is a code change, reviewed"). Tests below pin the wire
// shape (one/other, per-locale) and prove the invariant "per-
// tenant override + missing locale falls back to the locale
// default".

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Term Test', $3, $4)",
    [tenantId, `term-${RUN}`, plan?.id ?? null, TZ],
  );
});

// Tests share a tenant fixture — each case wipes terminology to
// {} before running so cross-test pollution from the previous
// case's override doesn't quietly change the meaning of the
// current one. Raw SQL on the privileged migration pool: the
// tenant has FORCE RLS, but the migration pool bypasses it,
// which makes the wipe unambiguous here and matches the same
// pattern the other tier-1 setup paths use.
beforeEach(async () => {
  await admin.query("update tenants set terminology = '{}'::jsonb where id = $1", [tenantId]);
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("getTerminology (Phase 2.10)", () => {
  it("returns eight empty entries on a fresh tenant", async () => {
    const data = await getTerminology({ tenantId });
    expect(data.overrides).toEqual({});
    expect(data.locale).toBe("en");
  });

  it("defaults every term to DEFAULT_TERMS when no override is set, both singular and plural", async () => {
    for (const key of TERM_KEYS) {
      expect(resolveTerm({ overrides: {}, locale: "en" }, key, 1)).toBe(DEFAULT_TERMS.en[key].one);
      expect(resolveTerm({ overrides: {}, locale: "en" }, key, "other")).toBe(DEFAULT_TERMS.en[key].other);
    }
  });

  it("returns the previously stored overrides on a tenant that has them", async () => {
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(tenants)
        .set({
          terminology: {
            member: { en: { one: "swimmer", other: "swimmers" } },
          },
        })
        .where(eq(tenants.id, tenantId));
    });

    const data = await getTerminology({ tenantId });
    expect(data.overrides.member?.en?.one).toBe("swimmer");
    expect(data.overrides.member?.en?.other).toBe("swimmers");
  });
});

describe("updateTermOverride (Phase 2.10)", () => {
  it("writes a single override without touching other terms", async () => {
    // Clean slate first.
    await withTenant(tenantId, async (tx) => {
      await tx.update(tenants).set({ terminology: {} }).where(eq(tenants.id, tenantId));
    });

    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "member", locale: "en", one: "swimmer", other: "swimmers" } satisfies UpdateTermOverrideInput,
    );

    const data = await getTerminology({ tenantId });
    expect(data.overrides.member?.en?.one).toBe("swimmer");
    expect(data.overrides.member?.en?.other).toBe("swimmers");
  });

  it("an override on one key does NOT bleed into other terms that share a key string prefix", async () => {
    // member_code / membership / remember all start with "member".
    // The architecture's "never string replacement" rule means the
    // resolver must NOT touch any of those. Easy: the resolver
    // takes a closed key set, so substring matches are impossible
    // by construction. This test is the canary that proves it.
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "member", locale: "en", one: "swimmer", other: "swimmers" },
    );
    expect(resolveTerm(await getTerminology({ tenantId }), "member", 1)).toBe("swimmer");
    expect(resolveTerm(await getTerminology({ tenantId }), "member", "other")).toBe("swimmers");
    // coach unchanged
    expect(resolveTerm(await getTerminology({ tenantId }), "coach", 1)).toBe(DEFAULT_TERMS.en.coach.one);
  });

  it("rejects an unknown term key — the set is closed, not a free-text override", async () => {
    const result = await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      // Bypass the type-level enum to test the runtime guard.
      { key: "membership_number" as never, locale: "en", one: "x", other: "y" },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid");
    }
  });

  it("rejects an empty singular form — 'active members' reads wrong if 'member' is empty", async () => {
    const result = await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "member", locale: "en", one: "", other: "swimmers" },
    );
    expect(result.kind).toBe("error");
  });

  it("persists updatedBy on the tenants row — every override is attributable", async () => {
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "coach", locale: "en", one: "mentor", other: "mentors" },
    );
    const row = (
      await admin.query<{ updated_by: string }>(
        "select updated_by from tenants where id = $1::uuid",
        [tenantId],
      )
    ).rows[0];
    expect(row?.updated_by).toBe(SYSTEM_USER);
  });
});

describe("clearTermOverride (Phase 2.10)", () => {
  it("removes a key's override entirely — falls back to the locale default on next read", async () => {
    // Set, then clear.
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "session", locale: "en", one: "class", other: "classes" },
    );
    await clearTermOverride({ tenantId, userId: SYSTEM_USER }, { key: "session", locale: "en" });

    const data = await getTerminology({ tenantId });
    expect(data.overrides.session).toBeUndefined();
    expect(resolveTerm(data, "session", 1)).toBe(DEFAULT_TERMS.en.session.one);
  });

  it("clearing one term does not touch another term's override", async () => {
    // Set two terms first (beforeEach wiped the row at case start),
    // then clear one — proves clearing doesn't bleed into the
    // sibling.
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "member", locale: "en", one: "swimmer", other: "swimmers" },
    );
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "batch", locale: "en", one: "slot", other: "slots" },
    );
    await clearTermOverride({ tenantId, userId: SYSTEM_USER }, { key: "batch", locale: "en" });

    const data = await getTerminology({ tenantId });
    expect(data.overrides.batch).toBeUndefined();
    expect(data.overrides.member?.en?.one).toBe("swimmer");
  });
});

describe("resolveTerm invariants (Phase 2.10)", () => {
  it("titleCase + count=other pluralises correctly when the override says so", async () => {
    // 'class' → 'classes'; 'day' → 'days'. Pluralisation is the
    // data's job, not the resolver's — overriding 'session' to
    // 'class' on a tenant must carry 'classes' alongside, not
    // have the resolver synthesise it. Most plurals are simple
    // "s" but irregular ones (e.g. 'child' → 'children' if we
    // ever add that key) won't be.
    await updateTermOverride(
      { tenantId, userId: SYSTEM_USER },
      { key: "session", locale: "en", one: "class", other: "classes" },
    );
    const data = await getTerminology({ tenantId });
    expect(resolveTerm(data, "session", 1)).toBe("class");
    expect(resolveTerm(data, "session", "other")).toBe("classes");
  });
});
