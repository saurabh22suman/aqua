import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, programs } from "@/db/schema";
import { runSessionsGenerateJob } from "@/lib/jobs/sessions-generate-job";

// tenants has FORCE row level security, so fixture rows (and the status
// flip below) must go through the privileged migration pool, never the
// app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

let tenantId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Sessions Generate Job', $3)",
    [tenantId, `sgj-${RUN}`, plan.rows[0]?.id ?? null],
  );

  let programId = "";
  await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "SGJ Program" })
      .returning({ id: programs.id });
    programId = p.id;
  });

  await withTenant(tenantId, (tx) =>
    tx.insert(batches).values({
      tenantId,
      programId,
      capacity: 20,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "07:00",
      endTime: "08:00",
      name: "SGJ Batch",
    }),
  );
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

async function sessionCount(): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::int as n from sessions where tenant_id = $1",
    [tenantId],
  );
  return Number(rows[0].n);
}

describe("runSessionsGenerateJob — the self-defusing status check", () => {
  it("generates sessions for an active tenant", async () => {
    expect(await sessionCount()).toBe(0);

    await runSessionsGenerateJob(tenantId);

    expect(await sessionCount()).toBeGreaterThan(0);
  });

  it("is a no-op for a suspended tenant — a stale schedule does not create sessions", async () => {
    await admin.query("update tenants set status = 'suspended' where id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    expect(await sessionCount()).toBe(0);

    await runSessionsGenerateJob(tenantId);

    // Not "fewer than before" — exactly zero. The job must not partially
    // run before noticing the tenant is suspended.
    expect(await sessionCount()).toBe(0);

    await admin.query("update tenants set status = 'active' where id = $1", [tenantId]);
  });

  it("resumes once the tenant is reactivated — proves the check reads live status, not a cached one", async () => {
    expect(await sessionCount()).toBe(0);

    await runSessionsGenerateJob(tenantId);

    expect(await sessionCount()).toBeGreaterThan(0);
  });
});
