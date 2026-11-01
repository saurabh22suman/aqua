// Ops redesign (28 October 2026) — the browser fixture.
//
// A synthetic operator, a synthetic tenant and a synthetic lead, created
// through the product's OWN services so the rows carry the same audit
// trail and the same shape the pages read. Everything it writes lives
// in the validated DISPOSABLE test database (aqua_test_*); it never
// touches a development or customer database.
//
// The operator's credentials are written to a mode-0600 file OUTSIDE
// the repository (the harness state directory), so the coordinator can
// open the console in an isolated Chrome for the independent
// every-page review without the secret ever appearing in a log, a
// screenshot, a commit or a chat message.

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import {
  currentTotpCode,
  markTotpEnrolled,
  provisionPlatformUser,
} from "@/db/platform-auth";
import { asUserId } from "@/lib/ids";
import { createTenant } from "@/db/platform-tenant-create";
import { createLead } from "@/db/platform-leads";
import { transitionTenantStatus } from "@/db/platform-tenant-status";
import { privilegedFixturePool } from "../../tests/db/privileged-fixture";

export type OpsOperator = {
  id: string;
  email: string;
  password: string;
  totpSecret: string;
  role: "admin" | "viewer";
};

export type OpsFixture = {
  operator: OpsOperator;
  viewer: OpsOperator;
  tenantId: string;
  tenantSlug: string;
  leadId: string;
};

export const FIXTURE_FILE =
  process.env.AQUA_OPS_FIXTURE_FILE ??
  join(
    homedir(),
    ".local/state/aqua-harness/ops-redesign-20261028/fixture.json",
  );

/**
 * Create one synthetic operator with a working authenticator.
 *
 * The password and the TOTP secret are synthetic and local to the
 * disposable database; the secret never leaves the machine except
 * through the mode-0600 fixture file.
 */
export async function createOperator(
  role: "admin" | "viewer",
): Promise<OpsOperator> {
  const email = `ops-redesign-${role}-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}`;
  const result = await provisionPlatformUser({
    email,
    password,
    name: `Ops redesign ${role}`,
    role,
  });
  await markTotpEnrolled(result.id);
  return { id: result.id, email, password, totpSecret: result.totpSecret, role };
}

/**
 * Sign in through the real password + authenticator journey.
 *
 * The journey is the product's own: a native POST for the password and
 * a native POST for the six-digit code. Nothing here shortcuts the
 * server's session.
 */
export async function signIn(
  page: Page,
  base: string,
  operator: OpsOperator,
): Promise<void> {
  await page.goto(`${base}/ops/login`);
  await page.getByLabel("Email", { exact: true }).fill(operator.email);
  await page.getByLabel("Password", { exact: true }).fill(operator.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/ops/verify");
  await page
    .getByLabel("6-digit code", { exact: true })
    .fill(currentTotpCode(operator.totpSecret));
  await page.waitForURL(`${base}/ops`);
}

/**
 * The synthetic clubs the review sees, with the statuses that make the
 * Overview's figures and the needs-attention queue meaningful.
 *
 * They are created through the product's own services, so their status
 * transitions write the same audit rows a real activation writes.
 */
const SYNTHETIC_CLUBS = [
  { name: "Ops Review Academy", slug: "ops-review", status: "trial" },
  { name: "Harbour Line Swimming", slug: "harbour-line", status: "active" },
  { name: "Old Court Racquet Club", slug: "old-court", status: "suspended" },
] as const;

/**
 * Create the synthetic clubs, and put each one into the status its
 * name promises. Existing clubs are left alone, so this is safe to
 * call again.
 */
export async function ensureSyntheticClubs(
  operator: OpsOperator,
): Promise<void> {
  for (const club of SYNTHETIC_CLUBS) {
    const slug = `${club.slug}-${randomUUID().slice(0, 8)}`;
    const created = await createTenant(
      {
        name: club.name,
        slug,
        timezone: "Asia/Kolkata",
        currency: "INR",
        gstin: "27ABCDE1234F1Z5",
        locationName: "Main Campus",
        locationIsPrimary: true,
        presetKey: "multi-sport",
      },
      { actorId: asUserId(operator.id) },
    );
    if (created.kind === "error") continue;
    if (club.status === "trial") continue;
    await transitionTenantStatus(
      created.tenantId,
      {
        targetStatus: club.status,
        reason: "Synthetic review fixture.",
      },
      { actorId: asUserId(operator.id) },
    );
  }
}

/**
 * The one configuration key an OWNER may ask to change (its visibility
 * is owner_read, so the platform records a change request instead of
 * letting the owner edit it). A pending request gives the
 * configuration screen its real decision controls.
 */
const OWNER_REQUESTABLE_KEY = "access.location_scoped_staff";

/**
 * Seed the synthetic records the console needs to be reviewable: one
 * tenant (with its first location, created by the same transaction the
 * product uses) and one lead.
 *
 * The tenant is created through `createTenant`, so its own audit rows
 * and its plan/preset resolution are real — the Overview's activity
 * list and the tenant's audit tab then have genuine content instead of
 * a hand-written one.
 */
export async function seedSyntheticRecords(
  operator: OpsOperator,
): Promise<{ tenantId: string; tenantSlug: string; leadId: string }> {
  const slug = `ops-review-${randomUUID().slice(0, 8)}`;
  const tenant = await createTenant(
    {
      name: "Ops Review Academy",
      slug,
      timezone: "Asia/Kolkata",
      currency: "INR",
      gstin: "27ABCDE1234F1Z5",
      locationName: "Main Campus",
      locationIsPrimary: true,
      presetKey: "multi-sport",
    },
    { actorId: asUserId(operator.id) },
  );
  if (tenant.kind === "error") {
    throw new Error(`Synthetic tenant creation failed: ${tenant.message}`);
  }

  const lead = await createLead(
    {
      businessName: "Sunrise Sports Club",
      contactName: "Asha Menon",
      phone: "+919000000001",
      city: "Pune",
      source: "whatsapp",
      qualification: {
        sport: "swimming",
        memberCountBand: "50-150",
        feeModel: "monthly",
        collectionMode: "both",
        coachCount: 4,
        locations: 1,
        gstRegistered: true,
      },
    },
    { actorId: asUserId(operator.id) },
  );
  if (lead.kind === "error") {
    throw new Error(`Synthetic lead creation failed: ${lead.message}`);
  }

  return { tenantId: tenant.tenantId, tenantSlug: slug, leadId: lead.leadId };
}

/**
 * Make sure the tenant carries a PENDING configuration change request,
 * so the configuration screen has its real Resolve/Decline controls.
 *
 * It is safe to call again: a second request is another row in the
 * synthetic tenant's request list, and the console renders them all.
 */
export async function ensurePendingChangeRequest(
  tenantId: string,
): Promise<void> {
  // Fixture setup, through the privileged pool: the tenant-scoped
  // insert policy expects a tenant membership, and the synthetic
  // operator is a platform operator. The pool lives in the
  // allowlisted fixture directory, so this file never names the
  // privileged connection string itself.
  const existing = await privilegedFixturePool.query(
    "select id from config_change_requests where tenant_id = $1 and key = $2 and status = 'requested'",
    [tenantId, OWNER_REQUESTABLE_KEY],
  );
  if (existing.rows.length > 0) return;
  // requested_by points at a TENANT user; the synthetic operator is a
  // platform operator, so the fixture leaves it null rather than
  // pointing at a row in another table.
  await privilegedFixturePool.query(
    "insert into config_change_requests (id, tenant_id, key, requested_value, note, status) values (gen_random_uuid(), $1, $2, $3, $4, 'requested')",
    [
      tenantId,
      OWNER_REQUESTABLE_KEY,
      "true",
      "Synthetic review fixture — a club asked for scoped staff.",
    ],
  );
}

/** Persist the fixture for the independent review, mode 0600. */
export function writeFixture(fixture: OpsFixture): void {
  mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  chmodSync(FIXTURE_FILE, 0o600);
}

/** Read the persisted fixture (used by every browser check). */
export function readFixture(): OpsFixture {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      `No Ops fixture at ${FIXTURE_FILE}. Run e2e/ops-redesign/ops-fixture-seed.ts first.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as OpsFixture;
}
