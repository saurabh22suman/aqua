import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getFeesOverview } from "@/lib/services/fees-hub";

let a: Awaited<ReturnType<typeof fixture>>;
let b: Awaited<ReturnType<typeof fixture>>;
const period = { from: "2026-11-01", to: "2026-12-01" };
const dueIds = Array.from({ length: 5 }, () => randomUUID());
type Summary = { methodTotals?: Array<{ method: string; paise: number }>; followUps?: Array<{ id: string; payerName: string }> };

beforeAll(async () => {
  a = await fixture(); b = await fixture();
  await a.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'invoices.read')", [a.tenantId, a.roleId]);
  await a.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'invoices.read' from tenant_memberships where id=$2", [a.tenantId, a.managerMembership]);
  await b.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values($1,$2,$3,$4,'OTHER','2026-27','2026-09-01','2026-09-01',1000,0,1000,0,'issued')", [randomUUID(), b.tenantId, b.locationA, b.memberId]);
  for (let i = 0; i < dueIds.length; i++) {
    await a.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values($1,$2,$3,$4,$5,'2026-27','2026-10-01',$6,1000,0,1000,0,'issued')", [dueIds[i], a.tenantId, i === 4 ? a.locationB : a.locationA, a.memberId, `DUE-${i}`, `2026-10-0${i + 1}`]);
  }
  for (const [owner, location, method, amount, date] of [[a,a.locationA,"cash",100,"2026-11-10"],[a,a.locationA,"upi",200,"2026-11-11"],[a,a.locationA,"cash",400,"2026-10-10"],[a,a.locationB,"cash",800,"2026-11-10"],[b,b.locationA,"cash",1600,"2026-11-10"]] as const) {
    await owner.admin.query("insert into payments(id,tenant_id,location_id,member_id,amount_paise,method,received_at) values($1,$2,$3,$4,$5,$6,$7)", [randomUUID(),owner.tenantId,location,owner.memberId,amount,method,date]);
  }
});
afterAll(async () => { if (a) await a.cleanup(); if (b) await b.cleanup(); });

it("scopes gross method totals and oldest current dues to tenant and club", async () => {
  const ctx = { ...a.context(), permissions: new Set(["reports.financial", "invoices.read"]) };
  const result = await getFeesOverview(ctx, period, { locationId: a.locationA });
  const summary = result as typeof result & Summary;
  expect(summary.methodTotals).toEqual(expect.arrayContaining([{ method: "cash", paise: 100 }, { method: "upi", paise: 200 }]));
  expect(summary.methodTotals?.reduce((sum, row) => sum + row.paise, 0)).toBe(result.collectedPaise);
  expect(result.collectedPaise).toBe(300);
  expect(summary.followUps?.map(row => row.id)).toEqual(dueIds.slice(0, 3));
  expect(summary.followUps?.[0]?.payerName).toBe("Synthetic member");
  const scoped = await getFeesOverview({ ...a.context(a.managerId, "manager"), permissions: new Set(["reports.financial", "invoices.read"]) }, period);
  expect(scoped.collectedPaise).toBe(300);
  expect(scoped.followUps?.map((row) => row.id)).toEqual(dueIds.slice(0, 3));
});

it("never returns payer details without a live grant, and distinguishes zero from unavailable", async () => {
  const ctx = { ...a.context(), permissions: new Set(["reports.financial", "invoices.read"]) };
  await a.admin.query("delete from role_permissions where tenant_id=$1 and role_id=$2 and permission_key='invoices.read'", [a.tenantId, a.roleId]);
  const hidden = await getFeesOverview(ctx, period, { locationId: a.locationA }) as Summary;
  expect(hidden.followUps).toBeUndefined();
  const empty = await getFeesOverview(ctx, { from: "2027-01-01", to: "2027-02-01" }, { locationId: a.locationA }) as Summary;
  expect(empty.methodTotals).toEqual([]);
});
