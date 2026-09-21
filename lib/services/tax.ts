import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { resolveConfigInTx, type ResolvedConfig } from "@/db/config";
import { locations } from "@/db/schema/locations";
import { facilities } from "@/db/schema/preset-engine";
import { tenants } from "@/db/schema/tenants";
import { gstDocumentKind } from "@/lib/gst";
import type { TenantId } from "@/lib/ids";

// The GST rate key and the ops-side read that shows every level of its
// resolution: tenant default, per facility, per activity. The console
// edits these through setPlatformScopedConfigValue (db/config-admin).

export const GST_RATE_KEY = "billing.gst_rate_bp" as const;

// The counter surfaces quote before they write. An unregistered
// supplier (no GSTIN) issues a bill of supply, so a preview must not
// show GST the issued document will not carry — see createOrder
// (lib/services/orders.ts), which zeroes the snapshot for the same
// reason.
export async function isGstRegistered(tenantId: TenantId): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ gstin: tenants.gstin })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return gstDocumentKind(row?.gstin ?? null) === "tax_invoice";
  });
}

export type TaxScopeRow = {
  scopeType: "tenant" | "location" | "activity";
  scopeId: string | null;
  label: string;
  rateBp: number;
  source: {
    scopeType: string;
    scopeId: string | null;
    setBy: string | null;
    setAt: string | null;
  };
};

export type TenantTaxConfig = {
  tenant: TaxScopeRow;
  locations: TaxScopeRow[];
  activities: TaxScopeRow[];
};

export async function getTenantTaxConfig(
  tenantId: TenantId,
): Promise<TenantTaxConfig> {
  return withTenant(tenantId, async (tx) => {
    const tenantResolved = await resolveConfigInTx<number>(
      tx,
      tenantId,
      GST_RATE_KEY,
    );

    const locationRows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(
        and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt)),
      )
      .orderBy(asc(locations.name));

    const activityRows = await tx
      .select({
        id: facilities.id,
        name: facilities.name,
        locationId: facilities.locationId,
      })
      .from(facilities)
      .where(
        and(eq(facilities.tenantId, tenantId), isNull(facilities.deletedAt)),
      )
      .orderBy(asc(facilities.name));

    const locationName = new Map(
      locationRows.map((location) => [location.id, location.name]),
    );

    const locationScopes: TaxScopeRow[] = [];
    for (const location of locationRows) {
      const resolved = await resolveConfigInTx<number>(
        tx,
        tenantId,
        GST_RATE_KEY,
        { locationId: location.id },
      );
      locationScopes.push({
        scopeType: "location",
        scopeId: location.id,
        label: location.name,
        rateBp: resolved.value,
        source: toSource(resolved),
      });
    }

    const activityScopes: TaxScopeRow[] = [];
    for (const activity of activityRows) {
      const resolved = await resolveConfigInTx<number>(
        tx,
        tenantId,
        GST_RATE_KEY,
        { locationId: activity.locationId, activityId: activity.id },
      );
      activityScopes.push({
        scopeType: "activity",
        scopeId: activity.id,
        label: `${activity.name} · ${locationName.get(activity.locationId) ?? ""}`,
        rateBp: resolved.value,
        source: toSource(resolved),
      });
    }

    return {
      tenant: {
        scopeType: "tenant",
        scopeId: null,
        label: "Tenant default",
        rateBp: tenantResolved.value,
        source: toSource(tenantResolved),
      },
      locations: locationScopes,
      activities: activityScopes,
    };
  });
}

function toSource(resolved: ResolvedConfig): TaxScopeRow["source"] {
  return {
    scopeType: resolved.source.scopeType,
    scopeId: resolved.source.scopeId,
    setBy: resolved.source.setBy,
    setAt: resolved.source.setAt
      ? new Date(resolved.source.setAt).toISOString()
      : null,
  };
}
