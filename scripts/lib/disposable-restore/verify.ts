// B6 — proving the restored database is USABLE, not merely present.
//
// A dump that restores without an error proves very little. What an
// operator actually needs to know is:
//
//   1. the schema and every applied migration came back;
//   2. the exact rows came back, values and all;
//   3. money came back as exact bigint paise, not a rounded float;
//   4. the application role can read and write the restored tables;
//   5. every tenant table still has RLS enabled AND forced;
//   6. the application role did not become a superuser or gain
//      BYPASSRLS;
//   7. two tenants in the RESTORED database are still isolated from
//      each other.
//
// Each check lives in its own module (records, privileges, isolation);
// this one orchestrates them and turns their findings into a list of
// problems. A drill that cannot fail is not a drill.

import { Pool } from "pg";
import type { DisposableTarget } from "./target";
import type { SyntheticFixture } from "./seed";
import {
  compareMoney,
  readTenantRecords,
  type MoneyComparison,
  type TenantRecord,
} from "./records";
import {
  checkGrants,
  checkRls,
  checkRoleAttributes,
  type GrantCheck,
  type RlsCheck,
  type RoleAttributeCheck,
} from "./privileges";
import { checkTenantIsolation, type IsolationProbe } from "./isolation";

export type VerificationSummary = {
  migrations: {
    source: string[];
    destination: string[];
    missing: string[];
    unexpected: string[];
  };
  records: {
    source: TenantRecord[];
    destination: TenantRecord[];
    identical: boolean;
  };
  money: MoneyComparison;
  grants: GrantCheck;
  rls: RlsCheck;
  roleAttributes: RoleAttributeCheck;
  isolation: IsolationProbe[];
  problems: string[];
};

export async function verifyRestoredDatabase(
  source: DisposableTarget,
  destination: DisposableTarget,
  fixture: SyntheticFixture,
): Promise<VerificationSummary> {
  const sourcePool = new Pool({ connectionString: source.adminUri });
  const destinationPool = new Pool({ connectionString: destination.adminUri });

  try {
    const sourceMigrations = await appliedMigrations(sourcePool);
    const destinationMigrations = await appliedMigrations(destinationPool);

    const sourceRecords = await readTenantRecords(sourcePool, fixture);
    const destinationRecords = await readTenantRecords(destinationPool, fixture);

    const summary: VerificationSummary = {
      migrations: {
        source: sourceMigrations,
        destination: destinationMigrations,
        missing: sourceMigrations.filter((m) => !destinationMigrations.includes(m)),
        unexpected: destinationMigrations.filter((m) => !sourceMigrations.includes(m)),
      },
      records: {
        source: sourceRecords,
        destination: destinationRecords,
        identical:
          JSON.stringify(sourceRecords) === JSON.stringify(destinationRecords),
      },
      money: compareMoney(destinationRecords, fixture),
      grants: await checkGrants(destinationPool),
      rls: await checkRls(destinationPool),
      roleAttributes: await checkRoleAttributes(destinationPool),
      isolation: await checkTenantIsolation(destination, fixture),
      problems: [],
    };
    summary.problems = collectProblems(summary, fixture);
    return summary;
  } finally {
    await sourcePool.end();
    await destinationPool.end();
  }
}

/**
 * Throws when the verification found anything wrong.
 */
export function assertVerificationPassed(summary: VerificationSummary): void {
  if (summary.problems.length > 0) {
    throw new Error(
      `The restored database did not pass verification:\n- ${summary.problems.join("\n- ")}`,
    );
  }
}

async function appliedMigrations(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    "select name from _migrations order by name",
  );
  return rows.map((r) => r.name);
}

function collectProblems(
  summary: VerificationSummary,
  fixture: SyntheticFixture,
): string[] {
  const problems: string[] = [];

  if (summary.migrations.missing.length > 0) {
    problems.push(
      `${summary.migrations.missing.length} applied migration(s) are missing from the restored database (e.g. ${summary.migrations.missing[0]}).`,
    );
  }
  if (summary.migrations.unexpected.length > 0) {
    problems.push(
      `The restored database carries ${summary.migrations.unexpected.length} migration(s) the source did not have.`,
    );
  }
  if (!summary.records.identical) {
    problems.push(
      "The restored records do not match the source records exactly.",
    );
  }
  if (!summary.money.exact) {
    problems.push(
      `Money did not round-trip exactly: expected ${summary.money.expectedTotalPaise} paise, restored invoice ${summary.money.restoredInvoiceTotalPaise}, payment ${summary.money.restoredPaymentAmountPaise}.`,
    );
  }
  if (summary.grants.missing.length > 0) {
    problems.push(
      `The application role is missing grants on: ${summary.grants.missing.join(", ")}.`,
    );
  }
  if (summary.grants.appendOnlyViolations.length > 0) {
    problems.push(
      `The application role can modify append-only tables: ${summary.grants.appendOnlyViolations.join(", ")}.`,
    );
  }
  if (summary.rls.notEnabled.length > 0) {
    problems.push(
      `Row level security is NOT enabled on: ${summary.rls.notEnabled.join(", ")}.`,
    );
  }
  if (summary.rls.notForced.length > 0) {
    problems.push(
      `Row level security is not FORCED on: ${summary.rls.notForced.join(", ")}.`,
    );
  }
  if (summary.roleAttributes.superuser.length > 0) {
    problems.push(
      `The application role is a superuser: ${summary.roleAttributes.superuser.join(", ")}.`,
    );
  }
  if (summary.roleAttributes.bypassRls.length > 0) {
    problems.push(
      `The application role can bypass row level security: ${summary.roleAttributes.bypassRls.join(", ")}.`,
    );
  }

  problems.push(...isolationProblems(summary, fixture));
  return problems;
}

function isolationProblems(
  summary: VerificationSummary,
  fixture: SyntheticFixture,
): string[] {
  const problems: string[] = [];
  const expectedMembers = [fixture.tenantA.memberId, fixture.tenantB.memberId].sort();

  for (const probe of summary.isolation) {
    if (probe.visibleMemberIds.length !== 1) {
      problems.push(
        `Tenant ${probe.scopeTenantId} sees ${probe.visibleMemberIds.length} member(s) in the restored database instead of exactly its own.`,
      );
    }
    if (probe.otherTenantMemberIdsVisible.length > 0) {
      problems.push(
        `Tenant ${probe.scopeTenantId} can see ${probe.otherTenantMemberIdsVisible.length} member(s) belonging to the other synthetic tenant in the restored database.`,
      );
    }
  }

  if (
    summary.isolation.length === 2 &&
    summary.isolation.every((p) => p.visibleMemberIds.length === 1)
  ) {
    const seen = summary.isolation.flatMap((p) => p.visibleMemberIds).sort();
    if (JSON.stringify(seen) !== JSON.stringify(expectedMembers)) {
      problems.push(
        "The two synthetic tenants do not each see exactly their own member in the restored database.",
      );
    }
  }

  return problems;
}
