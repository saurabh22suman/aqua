import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant, type TenantTx } from "@/db/tenant";
import type { ActionCtx } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit/write";
import { resolveBillingIdentityInTx } from "@/lib/services/facility-billing-identity";
import { authorize, failure, hasOpenOrders, OPEN_ORDERS_MESSAGE, parseAddress, sameAddress } from "@/lib/services/facility-billing-settings-core";
import { createBillingRegistrationSchema, resetSiteBillingSettingSchema, saveClubBillingDefaultSchema, saveSiteBillingSettingSchema, type BillingIssuer, type BillingResult, type ClubBillingDefault, type SiteBillingChoice, type SiteBillingSetting, type SaveSiteBillingSettingInput } from "@/lib/services/facility-billing-contract";

type ClubRow = { legal_name: string | null; legal_address: unknown; state_code: string | null; gstin: string | null };
type RegistrationRow = { id: string; legal_name: string; legal_address: unknown; state_code: string; gstin: string };
type SiteRow = { name: string; enabled: boolean | null; state_code: string | null; mode: string | null; registration_id: string | null; legal_name: string | null; legal_address: unknown };
const ok = <T>(value: T): BillingResult<T> => ({ ok: true, value });
const invalid = () => failure("invalid", "Invalid billing settings.");
const denied = () => failure("owner_required", "Only an owner with settings permission can manage billing settings.");
const notFound = () => failure("not_found", "Billing setting not found.");
const incomplete = () => failure("incomplete_issuer", "Complete the effective legal issuer before enabling facility billing.");

async function club(tx: TenantTx, ctx: ActionCtx): Promise<ClubBillingDefault | null> {
  const result = await tx.execute<ClubRow>(sql`select billing_legal_name as legal_name, billing_legal_address as legal_address, billing_state_code as state_code, gstin from tenants where id = ${ctx.tenantId}`);
  const r = result.rows[0];
  return r ? { legalName: r.legal_name, legalAddress: parseAddress(r.legal_address), stateCode: r.state_code, gstin: r.gstin } : null;
}
function complete(value: ClubBillingDefault): value is BillingIssuer {
  return !!value.legalName && !!value.legalAddress && !!value.stateCode && (!value.gstin || value.gstin.startsWith(value.stateCode));
}
async function registrations(tx: TenantTx, ctx: ActionCtx): Promise<Array<{ id: string; issuer: BillingIssuer }>> {
  const rows = await tx.execute<RegistrationRow>(sql`select id, legal_name, legal_address, state_code, gstin from billing_registrations where tenant_id = ${ctx.tenantId} order by created_at, id`);
  return rows.rows.flatMap((r) => {
    const address = parseAddress(r.legal_address);
    return address ? [{ id: r.id, issuer: { legalName: r.legal_name, legalAddress: address, stateCode: r.state_code, gstin: r.gstin } }] : [];
  });
}
async function site(tx: TenantTx, ctx: ActionCtx, locationId: string): Promise<SiteBillingSetting | null> {
  const rows = await tx.execute<SiteRow>(sql`select l.name, s.facility_billing_enabled as enabled, s.state_code, s.mode, s.registration_id, s.unregistered_legal_name as legal_name, s.unregistered_legal_address as legal_address from locations l left join location_billing_settings s on s.tenant_id = l.tenant_id and s.location_id = l.id where l.tenant_id = ${ctx.tenantId} and l.id = ${locationId} and l.deleted_at is null`);
  const row = rows.rows[0];
  if (!row) return null;
  let choice: SiteBillingChoice = { mode: "inherit" };
  if (row.mode === "registered_override" && row.registration_id) choice = { mode: row.mode, registrationId: row.registration_id };
  if (row.mode === "unregistered_override") {
    const address = parseAddress(row.legal_address);
    if (!row.legal_name || !address) return null;
    choice = { mode: row.mode, legalName: row.legal_name, legalAddress: address };
  }
  const resolved = row.enabled ? await resolveBillingIdentityInTx(tx, ctx.tenantId, locationId) : null;
  return { locationId, locationName: row.name, enabled: row.enabled ?? false, stateCode: row.state_code, choice, effectiveIssuer: resolved?.version === 1 ? resolved.issuer : null, registrations: await registrations(tx, ctx) };
}
function sameChoice(a: SiteBillingChoice, b: SiteBillingChoice): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "registered_override" && b.mode === "registered_override") return a.registrationId === b.registrationId;
  if (a.mode === "unregistered_override" && b.mode === "unregistered_override") return a.legalName === b.legalName && sameAddress(a.legalAddress, b.legalAddress);
  return true;
}
function sameIssuer(a: BillingIssuer | null, b: BillingIssuer | null): boolean {
  return !!a && !!b && a.legalName === b.legalName && a.stateCode === b.stateCode && a.gstin === b.gstin && sameAddress(a.legalAddress, b.legalAddress);
}
async function audit(tx: TenantTx, ctx: ActionCtx, action: string, entityId: string, before: unknown, after: unknown): Promise<void> {
  await writeAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId ?? null, action, entityType: "facility_billing", entityId, before, after });
}

export async function getClubBillingDefault(ctx: ActionCtx): Promise<BillingResult<ClubBillingDefault>> {
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    const current = await club(tx, ctx);
    return current ? ok(current) : notFound();
  });
}
export async function saveClubBillingDefault(ctx: ActionCtx, raw: unknown): Promise<BillingResult<ClubBillingDefault>> {
  const parsed = saveClubBillingDefaultSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const next = parsed.data;
  if (next.gstin && next.stateCode && !next.gstin.startsWith(next.stateCode)) return failure("state_mismatch", "GSTIN state does not match the issuer state.");
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    const before = await club(tx, ctx);
    if (!before) return notFound();
    if (before.legalName === next.legalName && before.stateCode === next.stateCode && before.gstin === next.gstin && sameAddress(before.legalAddress, next.legalAddress)) return ok(before);
    if (await hasOpenOrders(tx, ctx.tenantId, undefined, before.gstin !== next.gstin)) return failure("open_orders", OPEN_ORDERS_MESSAGE);
    const sites = await tx.execute<{ state_code: string }>(sql`select state_code from location_billing_settings where tenant_id = ${ctx.tenantId} and facility_billing_enabled and mode = 'inherit'`);
    if (sites.rows.length && !complete(next)) return incomplete();
    if (sites.rows.some((r) => r.state_code !== next.stateCode)) return failure("state_mismatch", "Issuer state must match every inheriting enabled site.");
    const address = next.legalAddress ? JSON.stringify(next.legalAddress) : null;
    await tx.execute(sql`update tenants set gstin = ${next.gstin}, billing_legal_name = ${next.legalName}, billing_legal_address = ${address}::jsonb, billing_state_code = ${next.stateCode}, updated_by = ${ctx.userId}, updated_at = now() where id = ${ctx.tenantId}`);
    await audit(tx, ctx, "facility_billing.default.update", ctx.tenantId, before, next);
    return ok(next);
  });
}
export async function getSiteBillingSetting(ctx: ActionCtx, locationId: string): Promise<BillingResult<SiteBillingSetting>> {
  if (!resetSiteBillingSettingSchema.safeParse({ locationId }).success) return invalid();
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    const value = await site(tx, ctx, locationId);
    return value ? ok(value) : notFound();
  });
}
export async function createBillingRegistration(ctx: ActionCtx, raw: unknown): Promise<BillingResult<{ id: string; issuer: BillingIssuer }>> {
  const parsed = createBillingRegistrationSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const issuer = parsed.data;
  if (!issuer.gstin.startsWith(issuer.stateCode)) return failure("state_mismatch", "GSTIN state does not match the issuer state.");
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    const id = uuidv7();
    await tx.execute(sql`insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values (${id},${ctx.tenantId},${issuer.legalName},${JSON.stringify(issuer.legalAddress)}::jsonb,${issuer.stateCode},${issuer.gstin})`);
    await audit(tx, ctx, "facility_billing.registration.create", id, null, issuer);
    return ok({ id, issuer });
  });
}

async function saveSiteInTx(tx: TenantTx, ctx: ActionCtx, next: SaveSiteBillingSettingInput): Promise<BillingResult<SiteBillingSetting>> {
    const before = await site(tx, ctx, next.locationId);
    if (!before) return notFound();
    if (before.enabled && !next.enable) return failure("cannot_disable", "An enabled site cannot revert to legacy billing.");
    if (before.enabled === next.enable && before.stateCode === next.stateCode && sameChoice(before.choice, next.choice)) return ok(before);
    let issuer: BillingIssuer | null = null;
    if (next.choice.mode === "inherit") {
      const value = await club(tx, ctx);
      if (value && complete(value)) issuer = value;
    } else if (next.choice.mode === "registered_override") {
      const registrationId = next.choice.registrationId;
      issuer = before.registrations.find((r) => r.id === registrationId)?.issuer ?? null;
      if (!issuer) return notFound();
    } else {
      issuer = { legalName: next.choice.legalName, legalAddress: next.choice.legalAddress, stateCode: next.stateCode, gstin: null };
    }
    if (next.enable && !issuer) return incomplete();
    if (issuer && issuer.stateCode !== next.stateCode) return failure("state_mismatch", "Issuer state does not match the site state.");
    const affectsIssuer = (!before.enabled && next.enable) || (before.enabled && !sameIssuer(before.effectiveIssuer, issuer));
    if (affectsIssuer && await hasOpenOrders(tx, ctx.tenantId, next.locationId)) return failure("open_orders", OPEN_ORDERS_MESSAGE);
    const registrationId = next.choice.mode === "registered_override" ? next.choice.registrationId : null;
    const legalName = next.choice.mode === "unregistered_override" ? next.choice.legalName : null;
    const legalAddress = next.choice.mode === "unregistered_override" ? JSON.stringify(next.choice.legalAddress) : null;
    await tx.execute(sql`insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,registration_id,unregistered_legal_name,unregistered_legal_address)
      values (${ctx.tenantId},${next.locationId},${next.stateCode},${next.enable},${next.choice.mode},${registrationId},${legalName},${legalAddress}::jsonb)
      on conflict (tenant_id,location_id) do update set state_code=excluded.state_code,facility_billing_enabled=excluded.facility_billing_enabled,mode=excluded.mode,registration_id=excluded.registration_id,unregistered_legal_name=excluded.unregistered_legal_name,unregistered_legal_address=excluded.unregistered_legal_address`);
    const after = await site(tx, ctx, next.locationId);
    if (!after) throw new Error("Billing setting disappeared after update");
    await audit(tx, ctx, "facility_billing.site.update", next.locationId, before, after);
    return ok(after);
}
export async function saveSiteBillingSetting(ctx: ActionCtx, raw: unknown): Promise<BillingResult<SiteBillingSetting>> {
  const parsed = saveSiteBillingSettingSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    return saveSiteInTx(tx, ctx, parsed.data);
  });
}
export async function resetSiteBillingSetting(ctx: ActionCtx, raw: unknown): Promise<BillingResult<SiteBillingSetting>> {
  const parsed = resetSiteBillingSettingSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await authorize(tx, ctx))) return denied();
    const current = await site(tx, ctx, parsed.data.locationId);
    if (!current) return notFound();
    if (current.choice.mode === "inherit") return ok(current);
    if (!current.stateCode) return incomplete();
    return saveSiteInTx(tx, ctx, { locationId: current.locationId, stateCode: current.stateCode, enable: current.enabled, choice: { mode: "inherit" } });
  });
}
