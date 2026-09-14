import { withPlatformAdmin } from "./scope";
import { locations } from "./schema/locations";
import { createTenant } from "./platform-tenant-create";
import { applyPreset } from "./preset-engine";
import { getLead, transitionLead, type LeadQualification } from "./platform-leads";
import { recordOpsAudit } from "./ops-action";
import type { TenantId, UserId } from "@/lib/ids";

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
      locationsCreated: number;
    }
  | {
      kind: "error";
      code: "invalid" | "not_found" | "already_converted" | "provision_failed";
      message: string;
    };

export async function convertLead(
  leadId: string,
  input: ConvertLeadInput,
  ctx: { actorId: UserId },
): Promise<ConvertLeadResult> {
  const lead = await getLead(leadId);
  if (!lead) {
    return { kind: "error", code: "not_found", message: "Lead not found." };
  }
  if (lead.status === "converted" || lead.trialTenantId !== null) {
    return {
      kind: "error",
      code: "already_converted",
      message: "This lead already has a tenant.",
    };
  }

  const selectedPreset = input.preset ?? presetForQualification(lead.qualification);
  const timezone = input.timezone ?? "Asia/Kolkata";
  const currency = input.currency ?? "INR";

  const created = await createTenant(
    {
      name: lead.businessName,
      slug: input.slug,
      timezone,
      planKey: input.planKey,
      currency,
      gstin: input.gstin,
      locationName: input.locationName ?? lead.city ?? "Main Location",
      locationIsPrimary: true,
    },
    { actorId: ctx.actorId },
  );
  if (created.kind !== "ok") {
    return {
      kind: "error",
      code: "provision_failed",
      message: created.message ?? "Tenant provisioning failed.",
    };
  }

  const presetResult = await applyPreset(created.tenantId, selectedPreset, {
    actorId: ctx.actorId,
  });

  // The qualification's location count (data-driven extra sites).
  const qualificationLocations =
    typeof lead.qualification["locations"] === "number"
      ? lead.qualification["locations"]
      : 1;
  const extraLocations = Math.max(0, Math.min(49, qualificationLocations - 1));
  if (extraLocations > 0) {
    await withPlatformAdmin(async (tx) => {
      for (let i = 0; i < extraLocations; i += 1) {
        await tx.insert(locations).values({
          tenantId: created.tenantId as TenantId,
          name: `Location ${i + 2}`,
          kind: "club",
          isPrimary: false,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
      }
      await recordOpsAudit(tx, {
        action: "platform_lead.convert",
        actorId: ctx.actorId,
        tenantId: created.tenantId,
        targetType: "tenant",
        targetId: created.tenantId,
        detail: { extraLocations },
      });
    });
  }

  // The lead moves to trial with the provisioned tenant recorded; the
  // later "mark converted" step is a separate, deliberate action.
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const moved = await transitionLead(
    leadId,
    {
      status: "trial",
      trialTenantId: created.tenantId,
      trialStartsAt: now.toISOString(),
      trialExpiresAt: trialEnds.toISOString(),
    },
    ctx,
  );

  // Even if the lead transition somehow fails, the tenant exists and is
  // audited; surface the failure rather than pretending.
  if (moved.kind !== "ok") {
    return {
      kind: "error",
      code: "provision_failed",
      message: `Tenant provisioned but the lead could not be updated: ${moved.message}`,
    };
  }

  return {
    kind: "ok",
    tenantId: created.tenantId,
    preset: selectedPreset,
    presetApplied: presetResult.kind === "ok",
    locationsCreated: 1 + extraLocations,
  };
}
