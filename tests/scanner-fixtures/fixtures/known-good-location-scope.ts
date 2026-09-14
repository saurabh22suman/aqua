// Known-good sibling for the location-scope fixture: the query consults
// the helper. Parsed, never executed.

import { members } from "@/db/schema/people";
import { resolveLocationAccess } from "@/lib/services/location-access";

type FakeTx = { select: () => { from: (table: unknown) => unknown } };

export async function listSomething(
  tx: FakeTx,
  ctx: { tenantId: string },
): Promise<unknown> {
  const access = await resolveLocationAccess(tx as never, ctx as never);
  if (access.unrestricted) return tx.select().from(members);
  return tx.select().from(members);
}
