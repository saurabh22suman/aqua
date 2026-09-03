import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { createBatch, createProgram, listBatches, listPrograms } from "@/lib/services/programs";
import { asTenantId } from "@/lib/ids";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());

beforeAll(async () => {
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Programs CRUD A', $3), ($4, $5, 'Programs CRUD B', $3)",
    [tenantA, `programs-crud-a-${RUN}`, plan.rows[0]?.id ?? null, tenantB, `programs-crud-b-${RUN}`],
  );
});

afterAll(async () => {
  // D2 — createBatch now materialises sessions synchronously, so
  // teardown has to clear those before batches (FK).
  await admin.query("delete from sessions where tenant_id = any($1)", [[tenantA, tenantB]]);
  await admin.query("delete from batches where tenant_id = any($1)", [[tenantA, tenantB]]);
  await admin.query("delete from programs where tenant_id = any($1)", [[tenantA, tenantB]]);
  await admin.query("delete from tenants where id = any($1)", [[tenantA, tenantB]]);
  await admin.end();
});

// C-16/C-17: programs and batches previously had no CRUD path at all --
// only scripts/seed.ts inserted rows directly. These prove the service
// layer works and is tenant-scoped, same as every other cross-tenant
// check in this suite.
describe("programs and batches CRUD", () => {
  it("creates and lists a program, scoped to its own tenant", async () => {
    const program = await createProgram({ tenantId: tenantA }, { name: "Swimming" });
    expect(program.name).toBe("Swimming");

    const listedA = await listPrograms({ tenantId: tenantA });
    expect(listedA.map((p) => p.id)).toContain(program.id);

    const listedB = await listPrograms({ tenantId: tenantB });
    expect(listedB.map((p) => p.id)).not.toContain(program.id);
  });

  it("creates and lists a batch with its program name, scoped to its own tenant", async () => {
    const program = await createProgram({ tenantId: tenantA }, { name: "Football" });
    const batch = await createBatch(
      { tenantId: tenantA },
      {
        programId: program.id,
        name: "U12 Squad",
        capacity: 15,
        daysOfWeek: [1, 3, 5],
        startTime: "16:00",
        endTime: "17:00",
      },
    );
    expect(batch.capacity).toBe(15);

    const listedA = await listBatches({ tenantId: tenantA });
    const found = listedA.find((b) => b.id === batch.id);
    expect(found?.programName).toBe("Football");

    const listedB = await listBatches({ tenantId: tenantB });
    expect(listedB.map((b) => b.id)).not.toContain(batch.id);
  });
});
