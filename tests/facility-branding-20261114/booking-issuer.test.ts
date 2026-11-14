import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { requestBookingBill } from "@/lib/services/booking-billing";

let f: Awaited<ReturnType<typeof fixture>>;
const facilityA = uuidv7(), facilityB = uuidv7();
const address = { line1: "Site Road", line2: null, city: "Bengaluru", postalCode: "560001" };

beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values($1,'pool.booking',true)",[f.tenantId]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'bookings.read'),($1,$2,'invoices.write')",[f.tenantId,f.roleId]);
  await f.admin.query("update tenants set gstin='27ABCDE1234F1Z5' where id=$1",[f.tenantId]);
  await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'billing.gst_rate_bp','tenant',$2::text,$2::text::uuid,'1800'::jsonb)",[uuidv7(),f.tenantId]);
  await f.admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values($1,$3,$4,'Site A Court','court',1),($2,$3,$5,'Site B Court','court',1)",[facilityA,facilityB,f.tenantId,f.locationA,f.locationB]);
  const registration = uuidv7();
  await f.admin.query("insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values($1,$2,'Registered Site', $3::jsonb,'29','29ABCDE1234F1Z5')",[registration,f.tenantId,JSON.stringify(address)]);
  await f.admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,unregistered_legal_name,unregistered_legal_address) values($1,$2,'29',true,'unregistered_override','Unregistered Site',$3::jsonb)",[f.tenantId,f.locationA,JSON.stringify(address)]);
  await f.admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,registration_id) values($1,$2,'29',true,'registered_override',$3)",[f.tenantId,f.locationB,registration]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from bookings where tenant_id=$1",[f.tenantId]);
  await f.admin.query("delete from facilities where tenant_id=$1",[f.tenantId]);
  await f.cleanup();
});

let slot = 0;
async function booking(location: string, facility: string) {
  const id=uuidv7();
  const start = new Date(Date.UTC(2026,10,15+slot++,0,30));
  const end = new Date(start.getTime()+3_600_000);
  await f.admin.query("insert into bookings(id,tenant_id,location_id,facility_id,walk_in_name,starts_at,ends_at,price_paise,status) values($1,$2,$3,$4,'Synthetic Guest',$5,$6,11800,'confirmed')",[id,f.tenantId,location,facility,start,end]);
  return id;
}

describe("Booking inclusive tax uses the enabled physical site's issuer", () => {
  it("charges no tax for an unregistered site even when club default is registered", async () => {
    const result=await requestBookingBill(f.context(),await booking(f.locationA,facilityA));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.bill).toMatchObject({ taxPaise:0,subtotalPaise:11800,totalPaise:11800,documentKind:"bill_of_supply" });
    const invoice=await f.admin.query("select issuer_legal_name,gstin,issuer_snapshot_version from invoices where id=$1",[result.bill.invoiceId]);
    expect(invoice.rows[0]).toMatchObject({issuer_legal_name:"Unregistered Site",gstin:null,issuer_snapshot_version:1});
  });
  it("applies site registration when the club default is unregistered, preserving inclusive total",async()=>{
    await f.admin.query("update tenants set gstin=null where id=$1",[f.tenantId]);
    const result=await requestBookingBill(f.context(),await booking(f.locationB,facilityB));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.bill).toMatchObject({taxPaise:1800,subtotalPaise:10000,totalPaise:11800,documentKind:"tax_invoice"});
  });

  it("waits on the tenant anchor before locking a booking, avoiding settings/writer lock inversion",async()=>{
    const id = await booking(f.locationA,facilityA);
    const holder = await f.admin.connect();
    let requested: ReturnType<typeof requestBookingBill> | undefined;
    let lockError: string | null = null;
    let observed = false;
    try {
      await holder.query("begin");
      const {rows} = await holder.query("select pg_backend_pid() as pid");
      await holder.query("select id from tenants where id=$1 for update",[f.tenantId]);
      requested = requestBookingBill(f.context(),id);
      void requested.catch(()=>{});
      const deadline=Date.now()+5_000;
      while(Date.now()<deadline){
        const waiting=await holder.query("select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and wait_event_type='Lock'",[rows[0].pid]);
        if(waiting.rowCount){observed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      try { await holder.query("select id from bookings where id=$1 for update nowait",[id]); }
      catch(error){lockError=(error as {code?:string}).code??"unknown";}
    } finally {
      await holder.query("rollback");holder.release();
    }
    const result = await requested;
    expect(observed).toBe(true);
    expect(lockError).toBeNull();
    expect(result?.ok).toBe(true);
  });
});
