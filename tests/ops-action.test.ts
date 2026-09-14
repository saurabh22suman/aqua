import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asUserId } from "@/lib/ids";

// O-05 (docs/ops-platform-design.md §5) — the audited ops mutation
// pipeline. This proves the recorder's shape both inside an opsAction
// wrapper and as a plain service call (seeds/tests), plus the closed
// scope union.

let container: StartedPostgreSqlContainer;
let admin: Pool;

const platformUserId = asUserId(uuidv7());
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
     values ($1, $2, 'O-05 Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `o05-${RUN}@platform.test`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("opsAction pipeline", () => {
  it("records actor, scope, reason, before and after from the wrapper context", async () => {
    const { opsAction, recordOpsAudit } = await import("@/db/ops-action");
    const { withPlatformAdmin } = await import("@/db/scope");

    await opsAction(
      {
        scope: "feature.update",
        actorId: platformUserId,
        tenantId: null,
        reason: "ticket #42",
        targetType: "feature",
        detail: { key: "cafe.pos" },
      },
      () =>
        withPlatformAdmin((tx) =>
          recordOpsAudit(tx, {
            action: "feature.update",
            actorId: null,
            before: { status: "internal" },
            after: { status: "beta" },
            detail: { key: "cafe.pos" },
          }),
        ),
    );

    const { rows } = await admin.query<{
      actor_id: string;
      action: string;
      target_type: string;
      detail: Record<string, unknown>;
    }>(
      `select actor_id, action, target_type, detail
         from platform_audit_log
        where actor_id = $1`,
      [platformUserId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("feature.update");
    expect(rows[0].actor_id).toBe(platformUserId);
    expect(rows[0].target_type).toBe("feature");
    expect(rows[0].detail).toMatchObject({
      key: "cafe.pos",
      reason: "ticket #42",
      before: { status: "internal" },
      after: { status: "beta" },
    });
  });

  it("uses the fallback action and actor outside an opsAction wrapper", async () => {
    const { recordOpsAudit } = await import("@/db/ops-action");
    const { withPlatformAdmin } = await import("@/db/scope");

    await withPlatformAdmin((tx) =>
      recordOpsAudit(tx, {
        action: "tenant.create",
        actorId: platformUserId,
        tenantId: null,
        detail: { seeded: true },
      }),
    );

    const { rows } = await admin.query<{ action: string }>(
      "select action from platform_audit_log where detail ->> 'seeded' = 'true'",
    );
    expect(rows).toEqual([{ action: "tenant.create" }]);
  });

  it("rejects a scope outside the closed union", async () => {
    const { opsAction } = await import("@/db/ops-action");
    await expect(
      opsAction(
        { scope: "anything.goes" as never, actorId: platformUserId },
        async () => 1,
      ),
    ).rejects.toThrow();
  });

  it("does not leak the ops context past the wrapper", async () => {
    const { currentOpsScope, opsAction } = await import("@/db/ops-action");
    await opsAction({ scope: "feature.update", actorId: platformUserId }, async () => 0);
    expect(currentOpsScope()).toBeNull();
  });
});
