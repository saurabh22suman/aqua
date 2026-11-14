import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";
import { GSTIN_RE, GST_STATE_NAMES } from "@/lib/gst";
import { billingAddressSchema, type BillingIssuer } from "@/lib/services/facility-billing-contract";

type Row = {
  club_gstin: string | null;
  club_name: string | null;
  club_address: unknown;
  club_state: string | null;
  enabled: boolean | null;
  mode: string | null;
  site_state: string | null;
  registration_gstin: string | null;
  registration_name: string | null;
  registration_address: unknown;
  registration_state: string | null;
  unregistered_name: string | null;
  unregistered_address: unknown;
};

export type ResolvedBillingIdentity =
  | { version: 0; gstin: string | null }
  | { version: 1; issuer: BillingIssuer };

// Caller must acquire the tenant anchor before other financial row locks.
export async function resolveBillingIdentityInTx(
  tx: TenantTx, tenantId: TenantId, locationId: string,
): Promise<ResolvedBillingIdentity | null> {
  const locked = await tx.execute(sql`select id from tenants where id = ${tenantId} for update`);
  if (locked.rows.length !== 1) return null;
  const result = await tx.execute<Row>(sql`
    select t.gstin as club_gstin, t.billing_legal_name as club_name,
      t.billing_legal_address as club_address, t.billing_state_code as club_state,
      s.facility_billing_enabled as enabled, s.mode, s.state_code as site_state,
      s.unregistered_legal_name as unregistered_name, s.unregistered_legal_address as unregistered_address,
      r.gstin as registration_gstin, r.legal_name as registration_name,
      r.legal_address as registration_address, r.state_code as registration_state
    from tenants t
    inner join locations l on l.tenant_id = t.id and l.id = ${locationId} and l.deleted_at is null
    left join location_billing_settings s on s.tenant_id = t.id and s.location_id = ${locationId}
    left join billing_registrations r on r.id = s.registration_id and r.tenant_id = t.id
    where t.id = ${tenantId}`);
  const row = result.rows[0];
  if (!row) return null;
  if (!row.enabled) return { version: 0, gstin: row.club_gstin };
  const registered = row.mode === "registered_override";
  const inherited = row.mode === "inherit";
  const unregistered = row.mode === "unregistered_override";
  if (!registered && !inherited && !unregistered) return null;
  const legalName = registered ? row.registration_name : inherited ? row.club_name : row.unregistered_name;
  const address = billingAddressSchema.safeParse(registered ? row.registration_address : inherited ? row.club_address : row.unregistered_address);
  const state = registered ? row.registration_state : inherited ? row.club_state : row.site_state;
  const gstin = registered ? row.registration_gstin : inherited ? row.club_gstin : null;
  if (!legalName?.trim() || !address.success || !state || !(state in GST_STATE_NAMES) || state !== row.site_state || (registered && !gstin) || (gstin !== null && (!GSTIN_RE.test(gstin) || !gstin.startsWith(state)))) return null;
  return { version: 1, issuer: { legalName, legalAddress: address.data, stateCode: state, gstin } };
}
