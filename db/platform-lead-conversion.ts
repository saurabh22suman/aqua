import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { locations } from "./schema/locations";
import { createTenantInput, provisionTenantInTransaction } from "./platform-tenant-create";
import { finishTenantProvisioning } from "./platform-tenant-provision";
import { platformLeads } from "./schema/platform-leads";
import { tenants } from "./schema/tenants";
import { type LeadQualification } from "./platform-leads";
import { recordOpsAudit } from "./ops-action";
import { actorIsActiveAdmin } from "./platform-tenant-commercial";
import type { UserId } from "@/lib/ids";

// O-10 (docs/ops-platform-design.md §7) — lead → tenant conversion,
// carrying the qualification answers forward: the sport selects the
// preset, the location count creates the extra sites, and the rest of
// the answers stay on the lead as the record of the sales conversation
// (the money/staff modules that would consume fee model, GST and coach
// count do not exist yet; when they do, they read them from here).

const PRESET_BY_SPORT: Record<string, string> = {
  swimming: "swimming",
  swim: "swimming",
  badminton: "badminton",
  football: "football",
  soccer: "football",
  gym: "gym",
  fitness: "gym",
  dance: "dance-ma",
  "martial arts": "dance-ma",
  martial: "dance-ma",
  tennis: "multi-sport",
  cricket: "multi-sport",
  basketball: "multi-sport",
  "multi-sport": "multi-sport",
};

export function presetForQualification(
  qualification: LeadQualification | Record<string, unknown>,
): string {
  const raw = qualification["sport"];
  const sport = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return PRESET_BY_SPORT[sport] ?? "start-from-scratch";
}

export type ConvertLeadInput = {
  slug: string;
  planKey?: string;
  timezone?: string;
  currency?: string;
  gstin?: string;
  locationName?: string;
  preset?: string;
};

export type ConvertLeadResult =
  | {
      kind: "ok";
      tenantId: string;
      preset: string;
      presetApplied: boolean;
      presetWarning: string | null;
      locationsCreated: number;
    }
  | {
      kind: "error";
      code: "invalid" | "not_found" | "already_converted" | "provision_failed";
      message: string;
      tenantId?: string;
    };

export async function convertLead(
  leadId: string,
  input: ConvertLeadInput,
  ctx: { actorId: UserId },
): Promise<ConvertLeadResult> {
  const transaction = await withPlatformAdmin(async (tx) => {
    const [lead] = await tx.select().from(platformLeads)
      .where(eq(platformLeads.id, leadId)).for("update");
    if (!lead) {
      return { kind: "error" as const, code: "not_found" as const, message: "Lead not found." };
    }
    if (!(await actorIsActiveAdmin(tx, ctx.actorId))) {
      return { kind: "error" as const, code: "invalid" as const, message: "An active administrator is required." };
    }
    const linked = lead.convertedTenantId ?? lead.trialTenantId;
    if (linked) {
      return {
        kind: "error" as const, code: "already_converted" as const,
        tenantId: linked, message: "This lead already has a tenant; use the linked tenant.",
      };
    }
    if (lead.status === "converted") {
      return { kind: "error" as const, code: "already_converted" as const, message: "This lead is already converted." };
    }
    const preset = input.preset ?? presetForQualification(lead.qualification);
    const parsed = createTenantInput.safeParse({
      name: lead.businessName,
      slug: input.slug,
      timezone: input.timezone,
      planKey: input.planKey,
      currency: input.currency,
      gstin: input.gstin,
      locationName: input.locationName ?? lead.city ?? "Main Location",
      locationIsPrimary: true,
      presetKey: preset,
    });
    if (!parsed.success) {
      return { kind: "error" as const, code: "invalid" as const, message: parsed.error.issues[0]?.message ?? "Invalid tenant details." };
    }
    const created = await provisionTenantInTransaction(tx, parsed.data, ctx);
    if (created.kind !== "ok") {
      return { kind: "error" as const, code: "provision_failed" as const, message: created.message };
    }
    const count = typeof lead.qualification.locations === "number" ? lead.qualification.locations : 1;
    const extraLocations = Math.max(0, Math.min(49, count - 1));
    for (let i = 0; i < extraLocations; i += 1) {
      await tx.insert(locations).values({
        tenantId: created.tenantId,
        name: `Location ${i + 2}`,
        kind: "club",
        isPrimary: false,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    }
    const now = new Date();
    const deadline = new Date(now.getTime() + 14 * 86400000);
    await tx.update(tenants).set({ trialExpiresAt: deadline })
      .where(eq(tenants.id, created.tenantId));
    await tx.update(platformLeads).set({
      status: "trial",
      trialTenantId: created.tenantId,
      trialStartsAt: now,
      trialExpiresAt: deadline,
      updatedAt: now,
      updatedBy: ctx.actorId,
    }).where(eq(platformLeads.id, leadId));
    await recordOpsAudit(tx, {
      action: "platform_lead.convert",
      actorId: ctx.actorId,
      tenantId: created.tenantId,
      targetType: "platform_lead",
      targetId: leadId,
      before: { status: lead.status },
      after: { status: "trial", trialTenantId: created.tenantId },
      detail: { extraLocations, trialExpiresAt: deadline.toISOString() },
    });
    return {
      kind: "ok" as const,
      tenantId: created.tenantId,
      preset,
      timezone: parsed.data.timezone,
      locationsCreated: 1 + extraLocations,
    };
  }).catch((error: unknown) => {
    let cause: unknown = error;
    for (let i = 0; i < 5 && cause && typeof cause === "object"; i += 1) {
      if ("code" in cause && cause.code === "23505" && "constraint" in cause && cause.constraint === "tenants_slug_key") {
        return { kind: "error" as const, code: "provision_failed" as const, message: "A tenant with this slug already exists." };
      }
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  });
  if (transaction.kind !== "ok") return transaction;
  const provisioning = await finishTenantProvisioning({ tenantId: transaction.tenantId, timezone: transaction.timezone, presetKey: transaction.preset, actorId: ctx.actorId }).catch(() => ({ presetApplied: false, presetWarning: "Tenant created; preset or schedule follow-up failed. Review the tenant and retry setup." }));
  return { kind: "ok", tenantId: transaction.tenantId, preset: transaction.preset, locationsCreated: transaction.locationsCreated, presetApplied: provisioning.presetApplied, presetWarning: provisioning.presetWarning };
}
