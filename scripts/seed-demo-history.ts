import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "../db/scope";
import { tenants } from "@/db/schema/tenants";
import { env } from "@/lib/env";
import { applyDemoHistory, type ApplyResult } from "./demo-history/apply";
import {
  APPLY_ENV_VAR,
  DEMO_TENANTS,
  assertAnchorDate,
  assertApplyApproved,
  assertDemoTenant,
  assertLocalDatabase,
} from "./demo-history/guards";

// The demo-history generator.
//
// Fills the demo tenant's recent past with the history the owner's
// charts need to be readable: money actually collected (cash, UPI, card,
// bank transfer and a little of everything else), membership dues that
// are paid, late, part-paid, split or still open, the sessions those
// dues pay for, the registers that were filled in, and the enquiries
// that came in.
//
// It writes ROWS. It never writes a chart value, never touches a
// service, and never fabricates an aggregate: the charts read the
// tables the application already reads, so what the owner sees is a
// reading of the history rather than a picture of it.
//
//   Dry run (writes nothing, prints what it would write):
//     pnpm tsx scripts/seed-demo-history.ts
//
//   Apply (needs BOTH the flag and the environment variable):
//     AQUA_DEMO_HISTORY_APPLY=1 pnpm tsx scripts/seed-demo-history.ts --apply
//
// The summary is printed as JSON on stdout (machine-readable) and as a
// short human report on stderr.

type CliOptions = {
  apply: boolean;
  tenant: string;
  days: number;
  today: string | undefined;
  jsonPath: string | undefined;
  restampAttendance: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    tenant: "demo-academy",
    days: 90,
    today: undefined,
    jsonPath: undefined,
    restampAttendance: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--tenant":
        options.tenant = next();
        break;
      case "--days": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          throw new Error("--days must be an integer between 1 and 365.");
        }
        options.days = value;
        break;
      }
      case "--today":
        options.today = next();
        break;
      case "--json":
        options.jsonPath = next();
        break;
      case "--no-restamp":
        options.restampAttendance = false;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: tsx scripts/seed-demo-history.ts [options]",
            "",
            "  --apply           write the history (also needs " + APPLY_ENV_VAR + "=1)",
            "  --tenant <slug>   the demo tenant (default: demo-academy)",
            "  --days <n>        how many days of history to plan (default: 90)",
            "  --today <date>    pin the anchor date (yyyy-mm-dd); default: the tenant's today",
            "  --json <path>     also write the JSON summary to a file",
            "  --no-restamp      leave the demo seed's attendance timestamps alone",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument "${arg}".`);
    }
  }
  return options;
}

function report(result: ApplyResult): void {
  const lines = [
    `${result.mode === "apply" ? "APPLIED" : "DRY RUN"} — ${result.tenant.name} (${result.tenant.slug})`,
    `window ${result.window.from} .. ${result.window.to} (${result.window.days} days, anchor ${result.window.anchorDate} ${result.window.timezone})`,
    `planned  sessions ${result.planned.sessions} (${result.planned.unmarkedSessions} unmarked), marks ${result.planned.marks}, ` +
      `subscriptions ${result.planned.subscriptions}, invoices ${result.planned.invoices}, payments ${result.planned.payments}, ` +
      `enquiries ${result.planned.enquiries}`,
    `inserted ${JSON.stringify(result.inserted)}`,
    `existing ${JSON.stringify(result.existing)}`,
    `restamped attendance marks ${result.restamped.attendanceMarks}`,
  ];
  const reconciliation = result.reconciliation;
  if (reconciliation) {
    lines.push(
      `money window ${reconciliation.window.from} .. ${reconciliation.window.to} (${reconciliation.window.timezone})`,
      `collections ${reconciliation.collections.totalPaise} paise over ${reconciliation.collections.paymentCount} payments ` +
        `on ${reconciliation.collections.daysWithPayments} days (${reconciliation.collections.daysWithoutPayments} quiet days)`,
      `methods    ${JSON.stringify(reconciliation.collections.byMethod)}`,
      `groups     ${JSON.stringify(reconciliation.collections.byGroup)}`,
      `attendance ${reconciliation.attendance.marks} marks, ${reconciliation.attendance.present} present ` +
        `(${reconciliation.attendance.pct ?? 0}%), ${reconciliation.attendance.daysWithMarks} days with marks`,
      `dues       ${reconciliation.dues.invoices} invoices ${JSON.stringify(reconciliation.dues.byStatus)}, ` +
        `outstanding ${reconciliation.dues.outstandingPaise} paise, overdue ${reconciliation.dues.overduePaise} paise`,
    );
  }
  const parity = result.chartParity;
  if (parity) {
    for (const period of parity.periods) {
      lines.push(
        `chart/${period.period.padEnd(5)} chart ${period.chart.collectionsPaise} paise / ${period.chart.paymentCount} payments, ` +
          `attendance ${period.chart.attendanceMarks} marks — rows ${period.rows.collectionsPaise} paise / ` +
          `${period.rows.paymentCount} payments, attendance ${period.rows.attendanceMarks} marks — ` +
          `${period.matches ? "MATCH" : "MISMATCH"}`,
      );
    }
    lines.push(`chart parity: ${parity.allMatch ? "every period matches the rows" : "MISMATCH"}`);
  }
  console.error(lines.join("\n"));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // 1. The database must be local and must not be production.
  assertLocalDatabase(env.DATABASE_URL, env.NODE_ENV);
  // 2. The tenant must be one of the demo tenants — by slug AND name.
  const expectedName = DEMO_TENANTS[options.tenant];
  if (!expectedName) {
    throw new Error(
      `Refusing to seed history: "${options.tenant}" is not a demo tenant. ` +
        `This tool only writes for: ${Object.keys(DEMO_TENANTS).join(", ")}.`,
    );
  }
  assertDemoTenant({ slug: options.tenant, name: expectedName });
  // 3. Writing needs an explicit opt-in.
  assertApplyApproved(process.env, options.apply);
  const anchorDate = assertAnchorDate(options.today);

  // The one platform read: find the tenant by its slug. Everything
  // after this point is tenant-scoped.
  const tenant = await withPlatformAdmin(async (tx) => {
    const [row] = await tx
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, options.tenant))
      .limit(1);
    return row ?? null;
  });
  if (!tenant) {
    throw new Error(
      `Tenant "${options.tenant}" was not found. Run the demo seed first (scripts/seed-demo.ts with the demo flag set).`,
    );
  }
  // The tenant row itself must still be the demo tenant.
  assertDemoTenant(tenant);

  const result = await applyDemoHistory({
    tenantId: tenant.id,
    apply: options.apply,
    windowDays: options.days,
    restampAttendance: options.restampAttendance,
    ...(anchorDate ? { anchorDate } : {}),
  });

  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (options.jsonPath) writeFileSync(options.jsonPath, `${json}\n`);
  report(result);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
