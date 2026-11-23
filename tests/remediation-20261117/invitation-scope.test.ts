import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { listInvitations } from "@/lib/services/staff-invitations";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("returns authoritative whole-business access separately from an empty club list", async () => {
  await f.admin.query("delete from membership_locations where tenant_id=$1 and membership_id=$2", [f.tenantId, f.managerMembership]);
  const rows = await listInvitations(f.context());
  expect(rows.find(row => row.membershipId === f.managerMembership)).toMatchObject({ allLocations: false, locationNames: [] });
  expect(rows.find(row => row.membershipId === f.membershipId)).toMatchObject({ allLocations: true, locationNames: [] });
});
