// B6 — the tenant isolation probe.
//
// This is the check that makes the drill worth running. A restored
// database can hold every row perfectly and still be unsafe, if the
// second tenant's rows became visible to the first.
//
// The probe reproduces exactly what withTenant() does (db/tenant.ts):
// connect as the application login, SET ROLE to the non-owner
// application role, and set the transaction-scoped app.tenant_id that
// the RLS policies branch on. It then asks the RESTORED database what
// that tenant can see.
//
// It deliberately does not use the application's own pool: the drill
// may be pointed at either side of the round trip, and an explicit
// connection string keeps the probe independent of the ambient
// environment.

import { Pool } from "pg";
import type { DisposableTarget } from "./target";
import type { SyntheticFixture } from "./seed";

export type IsolationProbe = {
  scopeTenantId: string;
  visibleMemberIds: string[];
  otherTenantMemberIdsVisible: string[];
};

export async function checkTenantIsolation(
  destination: DisposableTarget,
  fixture: SyntheticFixture,
): Promise<IsolationProbe[]> {
  const app = new Pool({
    connectionString: destination.appUri,
    max: 1,
    onConnect: async (client) => {
      await client.query("set role app_user");
    },
  });

  const probes: IsolationProbe[] = [];
  try {
    for (const scope of [fixture.tenantA, fixture.tenantB]) {
      const other =
        scope.tenantId === fixture.tenantA.tenantId
          ? fixture.tenantB
          : fixture.tenantA;
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id', $1, true)", [
          scope.tenantId,
        ]);
        const { rows } = await client.query<{ id: string; tenant_id: string }>(
          "select id, tenant_id from members",
        );
        await client.query("commit");
        probes.push({
          scopeTenantId: scope.tenantId,
          visibleMemberIds: rows
            .filter((r) => r.tenant_id === scope.tenantId)
            .map((r) => r.id)
            .sort(),
          otherTenantMemberIdsVisible: rows
            .filter((r) => r.tenant_id === other.tenantId)
            .map((r) => r.id)
            .sort(),
        });
      } finally {
        await client.query("rollback").catch(() => {});
        client.release();
      }
    }
  } finally {
    await app.end();
  }
  return probes;
}
