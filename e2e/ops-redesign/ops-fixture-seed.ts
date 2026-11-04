// Ops redesign (28 October 2026) — seed the review fixture.
//
// Run once against the validated DISPOSABLE test database. It creates
// one synthetic admin operator, one synthetic viewer operator, one
// synthetic tenant (with its first location) and one synthetic lead —
// all through the product's own services, so every row carries the
// audit trail the pages read.
//
// The operator credentials are written to a mode-0600 file OUTSIDE the
// repository. Nothing secret is printed: the output names the records
// and the routes the independent review needs, never a password or a
// one-time code.
//
//   python3 .opencode/scripts/lane_job.py exec bash -c \
//     'set -a; . ./.env.aqua-harness-test.local; set +a; \
//      pnpm exec tsx e2e/ops-redesign/ops-fixture-seed.ts'

import {
  createOperator,
  ensurePendingChangeRequest,
  ensureSyntheticClubs,
  readFixture,
  seedSyntheticRecords,
  writeFixture,
  FIXTURE_FILE,
} from "./ops-fixture";

async function main() {
  // The synthetic records are seeded ONCE: a second run would leave a
  // duplicate club in the disposable database for no benefit. Only the
  // operators are refreshed.
  const existing = (() => {
    try {
      return readFixture();
    } catch {
      return null;
    }
  })();

  const operator = await createOperator("admin");
  const viewer = await createOperator("viewer");
  const records = existing ?? (await seedSyntheticRecords(operator));
  await ensurePendingChangeRequest(records.tenantId);
  await ensureSyntheticClubs(operator);

  writeFixture({ operator, viewer, ...records });

  // No secret is printed: the coordinator reads the mode-0600 file.
  console.log("Ops review fixture ready.");
  console.log(`  credential file : ${FIXTURE_FILE} (mode 0600)`);
  console.log(`  tenant id       : ${records.tenantId}`);
  console.log(`  tenant slug     : ${records.tenantSlug}`);
  console.log(`  lead id         : ${records.leadId}`);
  console.log("  routes: /ops, /ops/tenants, /ops/tenants/new, /ops/tenants/<tenantId>{,configuration,entitlements,locations,messaging,tax,audit}, /ops/leads, /ops/leads/new, /ops/leads/<leadId>, /ops/features, /ops/presets, /ops/presets/<key>, /ops/whatsapp, /ops/activity, /ops/login, /ops/verify");
}

main().catch((error) => {
  console.error("Ops review fixture seed failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
