import { Client } from "pg";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { env } from "@/lib/env";

async function main(): Promise<void> {
  const client = new Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await client.connect();

  try {
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }

  console.log("public schema dropped.");

  await runMigrations(env.MIGRATION_DATABASE_URL);

  console.log("re-bootstrapping roles (default privileges do not survive schema drops)...");
  await bootstrapRoles(env.MIGRATION_DATABASE_URL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
