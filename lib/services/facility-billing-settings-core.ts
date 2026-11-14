import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { ActionCtx } from "@/lib/auth/context";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { billingAddressSchema, type BillingAddress, type BillingResult } from "@/lib/services/facility-billing-contract";

export const OPEN_ORDERS_MESSAGE = "Finish billing or void open café orders at the affected site before changing its billing identity or enabling facility billing.";
export function failure(code: "invalid" | "owner_required" | "not_found" | "incomplete_issuer" | "state_mismatch" | "open_orders" | "cannot_disable", message: string): BillingResult<never> {
  return { ok: false, code, message };
}
export async function authorize(tx: TenantTx, ctx: ActionCtx): Promise<boolean> {
  const tenant = await tx.execute(sql`select id from tenants where id = ${ctx.tenantId} for update`);
  if (!tenant.rows.length || !ctx.userId || !(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) return false;
  const grant = await tx.execute(sql`select 1 from tenant_memberships m
    join role_permissions p on p.role_id = m.role_id and p.tenant_id = m.tenant_id
    where m.tenant_id = ${ctx.tenantId} and m.user_id = ${ctx.userId}
      and m.status = 'active' and m.deleted_at is null and p.permission_key = 'settings.manage' limit 1 for share of p`);
  return grant.rows.length > 0;
}
export function sameAddress(a: BillingAddress | null, b: BillingAddress | null): boolean {
  return a === b || (!!a && !!b && a.line1 === b.line1 && a.line2 === b.line2 && a.city === b.city && a.postalCode === b.postalCode);
}
export function parseAddress(value: unknown): BillingAddress | null {
  const parsed = billingAddressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export async function hasOpenOrders(tx: TenantTx, tenantId: string, locationId?: string, includeLegacyDefaults = false): Promise<boolean> {
  // Legacy orders have no pinned issuer. A club GSTIN change therefore
  // affects absent/disabled sites as well as enabled inheriting sites.
  const affectedDefault = includeLegacyDefaults
    ? sql`(not coalesce(s.facility_billing_enabled, false) or s.mode = 'inherit')`
    : sql`(s.facility_billing_enabled and s.mode = 'inherit')`;
  const rows = locationId
    ? await tx.execute(sql`select 1 from orders where tenant_id = ${tenantId} and location_id = ${locationId} and status in ('placed','served') limit 1`)
    : await tx.execute(sql`select 1 from orders o left join location_billing_settings s on s.tenant_id = o.tenant_id and s.location_id = o.location_id where o.tenant_id = ${tenantId} and ${affectedDefault} and o.status in ('placed','served') limit 1`);
  return rows.rows.length > 0;
}
