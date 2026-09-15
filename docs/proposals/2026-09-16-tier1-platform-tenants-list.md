# Proposed diff — tests/tier1/platform-tenants-list.test.ts

This file lives outside `tests/tier1/` per the agent workflow rule
(`docs/agent-setup.md`): the agent's audit may propose Tier-1 changes
but cannot write into Tier-1 directly. A reviewer applies the diff.

## Item 6 — pin `listTenants({})` to the hermetic fixture set

The plan-name assertion at the file's "denormalises the plan name
via the plans LEFT JOIN" test does an unpaged `listTenants({})` and
then finds the fixture row by id. A populated shared-dev DB pages
the fixture out — already acknowledged in the file's earlier-test
comment ("a populated one (other suite tests' leftover tenants) pages
carol out"). The fix is the same `RUN` filter + `limit: 50` the
other order test uses.

```diff
--- a/tests/tier1/platform-tenants-list.test.ts
+++ b/tests/tier1/platform-tenants-list.test.ts
@@
   it("denormalises the plan name via the plans LEFT JOIN", async () => {
-    const result = await listTenants({});
+    // Hermetic: same RUN filter as the order test above. The default
+    // limit (50) is plenty on the shared dev DB; this test fails on
+    // a populated one if we ever paginate without the filter — see
+    // the order test's comment for the canonical reasoning.
+    const result = await listTenants({ search: RUN, limit: 50 });
     const alice = result.rows.find((r) => r.id === TENANT_IDS.alice);
     expect(alice?.planName).toBeTruthy();
     expect(alice?.planName).not.toBeNull();
   });
```

This is the cheaper fix; the test wasn't asserting anything about
the unpaged default. If a future contributor wants to pin
"listTenants({}) returns at most 50 rows", that's a separate test
with its own fixture.

## Second-instance search

The other test cases (`paginates with limit and offset`,
`filters by status when supplied`, `matches slug and name via
case-insensitive ILIKE search`, `zod-rejects an invalid status
before touching the database`) are already hermetic — they either
filter by `search: RUN` or `status: "suspended"` or use explicit
`limit/offset`. No other test depends on the unpaged default.
