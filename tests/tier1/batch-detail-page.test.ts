// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, type TenantId } from "@/lib/ids";
import BatchDetailPage from "@/app/(owner)/owner/batches/[batchId]/page";

// K1 — regression test for /owner/batches/[batchId].
//
// The page used to wrap getBatchAttendanceSummary in its own withTenant
// to read the tenant timezone first, which nests inside the service's
// own withTenant and trips enterScope's "Cannot enter tenant scope
// while already inside a tenant scope" guard. That made every owner
// drill-down from /owner/programs crash with a 500 — the most obvious
// click in the product, broken across ~100 PRs.
//
// The bug lived in the call site, not the service: getBatchAttendanceSummary
// passed its own service-layer test cleanly. So this test does NOT mock
// the service or assert on its shape; it drives the page function with
// the same Next.js context a real HTTP request carries, with real auth
// and a real DB row behind it, and asserts the page returns rendered
// output containing the batch name. That is the "click through to batch
// detail and assert 200" the K1 brief asked for, expressed without
// booting a real server: the render is the page, and a thrown error
// (the previous behaviour) would surface here as a rejected promise.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      // Mirrors better-auth's real shape ({ session, user } with a
      // fresh createdAt) so the receptionist session cap sees a live
      // session.
      getSession: async () => ({
        user: { id: authUser.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// BatchDetailPage calls notFound() if the batch doesn't exist for the
// tenant — redirect from a not-found page throws a NEXT_NOT_FOUND error,
// which vitest would otherwise let bubble up and fail the test for the
// wrong reason. Mock notFound as a thrown sentinel the test can either
// catch (negative case) or never see (happy case).
class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

// Each test gets its own tenant; cleanup is per-tenant at the end.
const createdTenants: { tenantId: TenantId; ownerUserId: string }[] = [];

afterAll(async () => {
  for (const { tenantId, ownerUserId } of createdTenants) {
    await admin.query("delete from attendance where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from users where id = $1::uuid", [ownerUserId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  }
  await admin.end();
});

async function setup(testLabel: string): Promise<{
  tenantId: TenantId;
  batchId: string;
}> {
  const tenantId = asTenantId(uuidv7());
  const ownerUserId = uuidv7();
  const ownerBetterAuthId = `k1-${testLabel}-${RUN}-${uuidv7().slice(0, 8)}`;
  const slug = `k1-${testLabel}-${RUN}-${uuidv7().slice(0, 8)}`;

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'K1 Batch Detail', 'active', $3)",
    [tenantId, slug, TZ],
  );
  await seedRoleTemplates(tenantId);
  const ownerRole = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = 'owner'",
      [tenantId],
    )
  ).rows[0]!.id;

  const locationId = uuidv7();
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'K1 Hall', true)",
    [locationId, tenantId],
  );

  await admin.query(
    "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
    [ownerUserId, `+91k1-${RUN}-${uuidv7()}`, ownerBetterAuthId],
  );

  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
    [uuidv7(), tenantId, ownerUserId, ownerRole],
  );

  const programRow = await admin.query<{ id: string }>(
    "insert into programs (id, tenant_id, name) values (gen_random_uuid(), $1, 'K1 Program') returning id",
    [tenantId],
  );
  const programId = programRow.rows[0]!.id;

  const batchRow = await admin.query<{ id: string }>(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time)
     values (gen_random_uuid(), $1, $2, 'K1 Detail Batch', 10, '{1,3,5}', '07:00', '08:00')
     returning id`,
    [tenantId, programId],
  );
  const batchId = batchRow.rows[0]!.id;

  createdTenants.push({ tenantId, ownerUserId });
  authUser.betterAuthId = ownerBetterAuthId;

  return { tenantId, batchId };
}

function renderToString(node: unknown): string {
  // The page returns a React element tree; we walk it for any string
  // child to assert on rendered text. Good enough for "page didn't
  // throw AND the batch name is on the page"; we don't need a full
  // jsdom render to prove the click-path works.
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderToString).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props: { children?: unknown } }).props;
    return renderToString(props.children);
  }
  return "";
}

describe("BatchDetailPage click-through", () => {
  it("renders the batch name and the this-month figure instead of throwing", async () => {
    const { batchId } = await setup("happy");

    // The pre-fix page rejected this call with
    //   "Cannot enter tenant scope while already inside a tenant scope"
    // because it opened withTenant(ctx.tenantId, …) and called
    // getBatchAttendanceSummary inside the callback; the service opens
    // its own withTenant, and enterScope (db/scope.ts) refuses that
    // nest. With the call site restructured (timezone read in its own
    // short transaction, service called from outside), this resolves
    // cleanly.
    const result = await BatchDetailPage({
      params: Promise.resolve({ batchId }),
    });

    const rendered = renderToString(result);
    expect(rendered).toContain("K1 Detail Batch");
    expect(rendered).toContain("This month");
  });

  it("notFound is signalled for a batch id that does not belong to this tenant", async () => {
    await setup("notfound");

    // A well-formed uuid, just not in this tenant's batch table. The
    // service returns null, the page calls notFound(), the mock turns
    // that into NotFoundSignal. Confirms the page's "batch not yours"
    // branch still goes through the standard 404 path rather than
    // throwing on a different error.
    await expect(
      BatchDetailPage({
        params: Promise.resolve({ batchId: uuidv7() }),
      }),
    ).rejects.toThrow(NotFoundSignal);
  });
});
