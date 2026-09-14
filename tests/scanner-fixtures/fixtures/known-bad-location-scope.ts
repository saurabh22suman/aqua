// Known-bad fixture for scripts/check-location-scope.ts. Parsed, never
// executed. The comment deliberately mentions resolveLocationAccess()
// to prove comments cannot satisfy the scan.

import { members } from "@/db/schema/people";

type FakeTx = { select: () => { from: (table: unknown) => unknown } };

export async function listSomething(tx: FakeTx): Promise<unknown> {
  // TODO: should this call resolveLocationAccess(tx, ctx)?
  return tx.select().from(members);
}
