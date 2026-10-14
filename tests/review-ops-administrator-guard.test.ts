import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asUserId } from "@/lib/ids";

// R03 (docs/audits/2026-10-13-role-workflow-audit.md §3) — platform
// viewers are read-only. Reproduction: before the fix, opsAction ran
// any callback for a viewer actor because it only wrapped the
// callback in an audit context; the platform role was never consulted
// below the action boundary. Now opsAction re-reads platform_users
// and refuses non-admin/non-active actors before the callback can run
// (and the exported actions gate on requireOpsAdminAction, pinned by
// scripts/check-ops-actions.ts).

let container: StartedPostgreSqlContainer;
let admin: Pool;

const adminUser = asUserId(uuidv7());
const viewerUser = asUserId(uuidv7());
const suspendedAdminUser = asUserId(uuidv7());
const unknownUser = asUserId(uuidv7());
const RUN = Date.now().toString(36);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $4, 'Admin', 'h', 's', 'admin', 'active'),
            ($2, $5, 'Viewer', 'h', 's', 'viewer', 'active'),
            ($3, $6, 'Suspended admin', 'h', 's', 'admin', 'suspended')`,
    [adminUser, viewerUser, suspendedAdminUser, `a-${RUN}@p.test`, `v-${RUN}@p.test`, `s-${RUN}@p.test`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("R03 platform admin guard inside the audited ops pipeline", () => {
  it("refuses a viewer actor before the mutation callback runs", async () => {
    const { opsAction, OpsForbiddenError } = await import("@/db/ops-action");
    let ran = false;
    await expect(
      opsAction({ scope: "feature.update", actorId: viewerUser }, async () => {
        ran = true;
        return "mutated";
      }),
    ).rejects.toBeInstanceOf(OpsForbiddenError);
    expect(ran).toBe(false);
  });

  it("refuses a suspended admin and an unknown actor", async () => {
    const { opsAction } = await import("@/db/ops-action");
    await expect(
      opsAction({ scope: "feature.update", actorId: suspendedAdminUser }, async () => 1),
    ).rejects.toThrow(/not an active admin/);
    await expect(
      opsAction({ scope: "feature.update", actorId: unknownUser }, async () => 1),
    ).rejects.toThrow(/not an active admin/);
  });

  it("runs the callback for an active admin (positive control)", async () => {
    const { opsAction } = await import("@/db/ops-action");
    const result = await opsAction(
      { scope: "feature.update", actorId: adminUser },
      async () => "mutated",
    );
    expect(result).toBe("mutated");
  });
});
