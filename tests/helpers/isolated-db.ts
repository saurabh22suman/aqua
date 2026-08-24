import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";

export type IsolatedDb = {
  container: StartedPostgreSqlContainer;
  admin: Pool;
  appUri: string;
  adminUri: string;
  stop: () => Promise<void>;
};

export async function startIsolatedDb(
  image = "postgres:16",
): Promise<IsolatedDb> {
  const container = await new PostgreSqlContainer(image).start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  await bootstrapRoles(adminUri, appPassword);
  await runMigrations(adminUri);

  const host = container.getHost();
  const port = container.getPort();
  const database = container.getDatabase();
  const appUri = `postgresql://app_login:${encodeURIComponent(appPassword)}@${host}:${port}/${database}`;

  const admin = new Pool({ connectionString: adminUri });

  return {
    container,
    admin,
    appUri,
    adminUri,
    stop: async () => {
      await admin.end();
      await container.stop();
    },
  };
}
