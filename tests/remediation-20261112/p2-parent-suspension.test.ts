import { randomUUID } from "node:crypto";
import { getReceiptForMember } from "@/lib/services/receipts";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { fixture } from "./fixture";
import { getParentViewData } from "@/lib/services/parent-view";
import { signParentLinkToken } from "@/lib/services/parent-link";
import { GET } from "@/app/p/[token]/route";
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();});afterAll(async()=>{await f?.cleanup();});
async function payment(){
  const invoice=randomUUID(),id=randomUUID();
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values($1,$2,$3,$4,$5,'2026-27','2026-11-12','2026-11-12',100,0,100,100,'paid')",[invoice,f.tenantId,f.locationA,f.memberId,invoice.slice(0,16)]);
  await f.admin.query("insert into payments(id,tenant_id,location_id,member_id,invoice_id,amount_paise,method) values($1,$2,$3,$4,$5,100,'cash')",[id,f.tenantId,f.locationA,f.memberId,invoice]);
  return id;
}
const view=()=>getParentViewData({tenantId:f.tenantId,personId:f.memberId,today:"2026-11-12",monthStart:"2026-11-01",monthEnd:"2026-11-30"});
describe("F05 legacy parent links revalidate club availability",()=>{
  it.each(["active","trial"])("retains access for %s clubs",async status=>{await f.admin.query("update tenants set status=$2 where id=$1",[f.tenantId,status]);expect((await view())?.child.fullName).toBe("Synthetic member");});
  it("refuses receipt reads and generation after suspension",async()=>{
    await f.admin.query("update tenants set status='active' where id=$1",[f.tenantId]);const id=await payment();expect((await getReceiptForMember(f.tenantId,f.memberId,id)).ok).toBe(true);
    await f.admin.query("update tenants set status='suspended' where id=$1",[f.tenantId]);
    expect((await getReceiptForMember(f.tenantId,f.memberId,id)).ok).toBe(false);const fresh=await payment();expect((await getReceiptForMember(f.tenantId,f.memberId,fresh)).ok).toBe(false);
    expect((await f.admin.query("select id from receipts where payment_id=$1",[fresh])).rowCount).toBe(0);
  });
  it("does not resolve a child or receipt through a foreign club",async()=>{
    await f.admin.query("update tenants set status='active' where id=$1",[f.tenantId]);const id=await payment();
    expect(await getParentViewData({tenantId:f.otherTenant,personId:f.memberId,today:"2026-11-12",monthStart:"2026-11-01",monthEnd:"2026-11-30"})).toBeNull();
    expect((await getReceiptForMember(f.otherTenant,f.memberId,id)).ok).toBe(false);
  });
  it.each(["suspended","churned"])("refuses personal data for a %s club",async status=>{
    await f.admin.query("update tenants set status=$2 where id=$1",[f.tenantId,status]);expect(await view()).toBeNull();
    const {token}=signParentLinkToken({tenantId:f.tenantId,personId:f.memberId});
    const response=await GET(new Request(`http://localhost/p/${token}`),{params:Promise.resolve({token})});
    expect(await response.text()).not.toContain("Synthetic member");expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
