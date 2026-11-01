// @vitest-environment node
//
// Lane c-money — location isolation for the owner money/report surfaces
// (F-04) and for the member wallet ledger (F-12).
//
// F-04: the owner analytics (collections, plan revenue, attendance
// trend, member mix) and the owner reports (enquiry funnel, retention)
// are read by a RESTRICTED admin whose membership carries an explicit
// location list. The dashboard (A07), the fees hub and the owner home
// charts all apply that boundary; these two read models did not, so a
// restricted admin saw every facility's money on /owner/reports.
//
// The rule under test is lib/services/location-access.ts's own:
// `access.location_scoped_staff` OFF  -> unrestricted (tenant-wide)
//                                   ON   -> ctx.allLocations / ctx.locationIds govern
// Both directions are asserted: the deny case AND the positive
// controls (an all-locations caller, and a tenant with the feature
// OFF, must still see the whole tenant).
//
// F-12: the wallet ledger's top-up checks the caller's location
// access; its charge, refund and balance read did not.
//
// Fixture setup and cleanup run through the privileged pool
// (tests/db/privileged-fixture.ts). Every assertion runs against the
// application's own services over the app_login connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";
import {
  getMoneyAnalytics,
  getOperationalAnalytics,
} from "@/lib/services/owner-analytics";
import {
  getEnquiryFunnel,
  getRetentionReport,
} from "@/lib/services/owner-reports";
import {
  balanceOf,
  charge,
  refund,
  topUp,
} from "@/lib/services/wallet";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

type Seeded = {
  tenantId: TenantId;
  locationA: string;
  locationB: string;
  memberA: string;
  memberB: string;
};

const scoped: Seeded = {
  tenantId: asTenantId(uuidv7()),
  locationA: uuidv7(),
  locationB: uuidv7(),
  memberA: "",
  memberB: "",
};
const open: Seeded = {
  tenantId: asTenantId(uuidv7()),
  locationA: uuidv7(),
  locationB: uuidv7(),
  memberA: "",
  memberB: "",
};
const walletTenant: Seeded = {
  tenantId: asTenantId(uuidv7()),
  locationA: uuidv7(),
  locationB: uuidv7(),
  memberA: "",
  memberB: "",
};

const seeded: Seeded[] = [scoped, open, walletTenant];

type Ctx = {
  tenantId: TenantId;
  userId: ReturnType<typeof asUserId>;
  roleKey: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: Set<string>;
};

const PERMISSIONS = [
  "dashboard.view",
  "reports.financial",
  "reports.operational",
  "payments.read",
];

let phoneCounter = 0;

// A real `users` row: audit_log.actor_id references users(id), so a
// caller that writes an audit row must exist.
async function makeUser(): Promise<ReturnType<typeof asUserId>> {
  phoneCounter += 1;
  const id = asUserId(randomUUID());
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    id,
    `+9199${RUN}${String(phoneCounter).padStart(3, "0")}`,
  ]);
  return id;
}

async function makeCtx(
  s: Seeded,
  shape: { roleKey: string; allLocations: boolean; locationIds: string[] },
): Promise<Ctx> {
  return {
    tenantId: s.tenantId,
    userId: await makeUser(),
    roleKey: shape.roleKey,
    allLocations: shape.allLocations,
    locationIds: shape.locationIds,
    permissions: new Set(PERMISSIONS),
  };
}

async function seedTenant(s: Seeded, slug: string): Promise<void> {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [s.tenantId, `${slug}-${RUN}`, slug, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'Site A', true), ($2, $3, 'Site B', false)",
    [s.locationA, s.locationB, s.tenantId],
  );
  const personA = uuidv7();
  const personB = uuidv7();
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $3, 'Scope Member A'), ($2, $3, 'Scope Member B')",
    [personA, personB, s.tenantId],
  );
  const memberA = uuidv7();
  const memberB = uuidv7();
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
     values ($1, $2, $3, $4, $5, 'active', current_date - 200),
            ($6, $2, $7, $8, $9, 'active', current_date - 200)`,
    [
      memberA,
      s.tenantId,
      personA,
      s.locationA,
      `SCOPE-A-${RUN}-${s.tenantId.slice(0, 6)}`,
      memberB,
      personB,
      s.locationB,
      `SCOPE-B-${RUN}-${s.tenantId.slice(0, 6)}`,
    ],
  );
  s.memberA = memberA;
  s.memberB = memberB;

  // One captured payment per site, plus one enquiry per site, both at
  // a fixed mid-day IST instant inside the reporting period.
  const today = todayInZone(TZ);
  const at = zonedWallTimeToInstant(today, "12:00", TZ);
  await admin.query(
    `insert into payments (id, tenant_id, member_id, location_id, amount_paise, method, received_at, status)
     values ($1, $2, $3, $4, 10000, 'cash', $5, 'captured'),
            ($6, $2, $7, $8, 20000, 'upi', $5, 'captured')`,
    [
      uuidv7(),
      s.tenantId,
      memberA,
      s.locationA,
      at,
      uuidv7(),
      memberB,
      s.locationB,
    ],
  );
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, source, stage, location_id, created_at)
     values ($1, $2, 'Enquiry A', 'phone', 'new', $3, $4),
            ($5, $2, 'Enquiry B', 'phone', 'new', $6, $4)`,
    [uuidv7(), s.tenantId, s.locationA, at, uuidv7(), s.locationB],
  );
}

let scopedOwner: Ctx;
let scopedRestricted: Ctx;
let openRestricted: Ctx;
let walletOwner: Ctx;
let walletRestricted: Ctx;

beforeAll(async () => {
  await seedTenant(scoped, "scoped");
  await seedTenant(open, "open");
  await seedTenant(walletTenant, "wallet");
  // The scoped tenant and the wallet tenant turn location scoping ON;
  // the "open" tenant leaves it off, so tenant-wide access stays
  // legitimate there.
  for (const s of [scoped, walletTenant]) {
    await admin.query(
      "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
      [randomUUID(), s.tenantId],
    );
  }
  scopedOwner = await makeCtx(scoped, {
    roleKey: "owner",
    allLocations: true,
    locationIds: [],
  });
  scopedRestricted = await makeCtx(scoped, {
    roleKey: "admin",
    allLocations: false,
    locationIds: [scoped.locationA],
  });
  openRestricted = await makeCtx(open, {
    roleKey: "admin",
    allLocations: false,
    locationIds: [open.locationA],
  });
  walletOwner = await makeCtx(walletTenant, {
    roleKey: "owner",
    allLocations: true,
    locationIds: [],
  });
  walletRestricted = await makeCtx(walletTenant, {
    roleKey: "admin",
    allLocations: false,
    locationIds: [walletTenant.locationA],
  });
}, 120_000);

afterAll(async () => {
  for (const s of seeded) {
    // The audit rows reference the actor user, so they go first (the
    // append-only guard is stepped around by the approved test-only
    // cleanup helper).
    await deleteAuditRowsForTenant(admin, s.tenantId);
    await admin.query("delete from payments where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from enquiries where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from account_entries where tenant_id = $1", [
      s.tenantId,
    ]);
    await admin.query("delete from members where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from config_values where tenant_id = $1", [
      s.tenantId,
    ]);
    await admin.query("delete from tenants where id = $1", [s.tenantId]);
  }
  await admin.query("delete from users where phone like $1", [`+9199${RUN}%`]);
  await admin.end();
});

function currentPeriod() {
  const today = todayInZone(TZ);
  return { from: today, to: addDays(today, 1) };
}

describe("F-04 — owner money analytics honour the caller's location access", () => {
  it("narrows collections and plan revenue to the caller's locations", async () => {
    const period = currentPeriod();
    const scopedRead = await getMoneyAnalytics(scopedRestricted, period);
    expect(scopedRead.collections.totalPaise).toBe(10000);
    expect(scopedRead.collections.byDay).toHaveLength(1);
    expect(scopedRead.collections.byDay[0]!.paise).toBe(10000);
  }, 60_000);

  it("keeps the whole tenant visible to an all-locations caller", async () => {
    const period = currentPeriod();
    const ownerRead = await getMoneyAnalytics(scopedOwner, period);
    expect(ownerRead.collections.totalPaise).toBe(30000);
  }, 60_000);

  it("keeps the whole tenant visible when location scoping is OFF", async () => {
    const period = currentPeriod();
    const openRead = await getMoneyAnalytics(openRestricted, period);
    expect(openRead.collections.totalPaise).toBe(30000);
  }, 60_000);

  it("narrows the member mix to the caller's locations", async () => {
    const period = currentPeriod();
    const scopedRead = await getOperationalAnalytics(
      scopedRestricted,
      period,
    );
    const total = scopedRead.memberMix.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(1);

    const ownerRead = await getOperationalAnalytics(scopedOwner, period);
    const ownerTotal = ownerRead.memberMix.reduce(
      (sum, row) => sum + row.count,
      0,
    );
    expect(ownerTotal).toBe(2);
  }, 60_000);
});

describe("F-04 — owner reports honour the caller's location access", () => {
  it("narrows the enquiry funnel to the caller's locations", async () => {
    const period = currentPeriod();
    const scopedRead = await getEnquiryFunnel(scopedRestricted, period);
    const scopedTotal = scopedRead.reduce((sum, row) => sum + row.total, 0);
    expect(scopedTotal).toBe(1);

    const ownerRead = await getEnquiryFunnel(scopedOwner, period);
    const ownerTotal = ownerRead.reduce((sum, row) => sum + row.total, 0);
    expect(ownerTotal).toBe(2);
  }, 60_000);

  it("narrows the retention denominator to the caller's locations", async () => {
    const scopedRead = await getRetentionReport(scopedRestricted);
    expect(scopedRead.row.totalActiveMembers).toBe(1);

    const ownerRead = await getRetentionReport(scopedOwner);
    expect(ownerRead.row.totalActiveMembers).toBe(2);
  }, 60_000);
});

describe("F-12 — the wallet ledger honours the caller's location access", () => {
  it("refuses a charge against a member outside the caller's locations", async () => {
    // Give the site-B member a balance first, as an unrestricted caller.
    const topped = await topUp(walletOwner, {
      memberId: walletTenant.memberB,
      locationId: walletTenant.locationB,
      amountPaise: 50000,
      method: "cash",
      idempotencyKey: `wallet-topup-${RUN}`,
    });
    expect(topped.ok).toBe(true);

    const denied = await charge(walletRestricted, {
      memberId: walletTenant.memberB,
      amountPaise: 10000,
      idempotencyKey: `wallet-charge-outside-${RUN}`,
    });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.error).toMatch(/not found/i);

    // The refused charge wrote nothing: the balance is untouched.
    expect(await balanceOf(walletOwner, walletTenant.memberB)).toBe(50000);
  }, 60_000);

  it("refuses a refund against a member outside the caller's locations", async () => {
    const denied = await refund(walletRestricted, {
      memberId: walletTenant.memberB,
      amountPaise: 1000,
      idempotencyKey: `wallet-refund-outside-${RUN}`,
    });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.error).toMatch(/not found/i);
  }, 60_000);

  it("refuses to read a balance outside the caller's locations", async () => {
    await expect(
      balanceOf(walletRestricted, walletTenant.memberB),
    ).rejects.toThrow(/not found/i);
  }, 60_000);

  it("still charges and reads a member inside the caller's locations", async () => {
    const topped = await topUp(walletOwner, {
      memberId: walletTenant.memberA,
      locationId: walletTenant.locationA,
      amountPaise: 50000,
      method: "cash",
      idempotencyKey: `wallet-topup-a-${RUN}`,
    });
    expect(topped.ok).toBe(true);

    const charged = await charge(walletRestricted, {
      memberId: walletTenant.memberA,
      amountPaise: 10000,
      idempotencyKey: `wallet-charge-inside-${RUN}`,
    });
    expect(charged.ok).toBe(true);
    expect(charged.ok === true && charged.balanceAfterPaise).toBe(40000);

    const balance = await balanceOf(walletRestricted, walletTenant.memberA);
    expect(balance).toBe(40000);
  }, 60_000);
});
