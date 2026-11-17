import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { ensureBaUserForPhone } from "@/lib/services/credentials";
import { listClubChoices } from "@/db/club-selection";

let f: Awaited<ReturnType<typeof fixture>>;
let baId: string;
beforeAll(async () => {
  f = await fixture();
  const { rows } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId]);
  baId = await ensureBaUserForPhone(rows[0]!.phone);
});
afterAll(async () => { await f?.cleanup(); });

describe("club account choices", () => {
  it("uses branding without turning two facilities into two memberships", async () => {
    await f.admin.query("update tenants set branding=$2 where id=$1", [f.tenantId, { displayName: "Branded Sports Club" }]);
    const choices = await listClubChoices(baId, new Date());
    expect(choices).toHaveLength(1);
    expect(choices[0]?.name).toBe("Branded Sports Club");
    expect(await listClubChoices(randomUUID(), new Date())).toEqual([]);
  });
  it("falls back to tenant name for blank branding and keeps long branded names", async () => {
    await f.admin.query("update tenants set branding=$2 where id=$1", [f.tenantId, { displayName: "   " }]);
    expect((await listClubChoices(baId, new Date()))[0]?.name).toBe("Remediation A");
    const longName = "A very long club account name ".repeat(5).trim();
    await f.admin.query("update tenants set branding=$2 where id=$1", [f.tenantId, { displayName: longName }]);
    expect((await listClubChoices(baId, new Date()))[0]?.name).toBe(longName);
  });
  it("does not expose branding after membership revocation", async () => {
    await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
    try { expect(await listClubChoices(baId, new Date())).toEqual([]); }
    finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
  });
});
