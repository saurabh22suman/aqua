import { Client } from "pg";
import readline from "node:readline/promises";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { confirmationMatches, describeTarget, evaluateResetGuard } from "@/db/reset-guard";
import { env, requireMigrationUrl } from "@/lib/env";

async function main(): Promise<void> {
  const decision = evaluateResetGuard({
    nodeEnv: env.NODE_ENV,
    demoMode: env.DEMO_MODE,
    argv: process.argv.slice(2),
  });
  if (!decision.allowed) {
    console.error(decision.reason);
    process.exit(1);
  }

  const migrationUrl = requireMigrationUrl("db/reset.ts");
  const { host, database } = describeTarget(migrationUrl);
  console.log("About to drop and recreate the public schema on:");
  console.log(`  host:     ${host}`);
  console.log(`  database: ${database}`);
  console.log("About to drop and recreate the public schema on:");
  console.log(`  host:     ${host}`);
  console.log(`  database: ${database}`);

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type the database name (${database}) to confirm: `);
    rl.close();
    if (!confirmationMatches(answer, database)) {
      console.error("Confirmation did not match — aborting.");
      process.exit(1);
    }
  }

  const client = new Client({ connectionString: migrationUrl });
  await client.connect();

  try {
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }

  console.log("public schema dropped.");

  console.log("bootstrapping roles before migrating (invariant: bootstrap precedes migrate)...");
  await bootstrapRoles(migrationUrl);

  await runMigrations(migrationUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
