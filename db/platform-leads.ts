import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { platformLeads, type PlatformLead } from "./schema/platform-leads";
import { recordOpsAudit } from "./ops-action";
import type { TenantId, UserId } from "@/lib/ids";

// O-09 (docs/ops-platform-design.md §7) — the sales spine's service.
// Platform-scoped: reads and writes go through withPlatformAdmin, and
// every mutation writes its audit row in the same transaction via the
// O-05 pipeline.

export const LEAD_SOURCES = [
  "website",
  "phone",
  "whatsapp",
  "referral",
  "other",
] as const;

export const LEAD_STATUSES = [
  "lead",
  "qualified",
  "demo_booked",
  "trial",
  "converted",
  "lapsed",
  "lost",
] as const;

export const leadQualificationSchema = z.object({
  sport: z.string().trim().max(80).optional(),
  memberCountBand: z.enum(["<50", "50-150", "150-400", "400+"]).optional(),
  feeModel: z.enum(["monthly", "per_hour", "both", "unknown"]).optional(),
  collectionMode: z.enum(["cash", "upi", "both", "unknown"]).optional(),
  gstRegistered: z.boolean().optional(),
  coachCount: z.number().int().min(0).max(500).optional(),
  locations: z.number().int().min(1).max(50).optional(),
});

export type LeadQualification = z.infer<typeof leadQualificationSchema>;

export const createLeadInput = z.object({
  businessName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  source: z.enum(LEAD_SOURCES),
  qualification: leadQualificationSchema.optional(),
});

export type CreateLeadInput = z.input<typeof createLeadInput>;

export const transitionLeadInput = z.object({
  status: z.enum(LEAD_STATUSES),
  lostReason: z.string().trim().max(500).optional(),
  opsOwnerId: z.string().uuid().optional(),
  trialTenantId: z.string().uuid().optional(),
  trialStartsAt: z.string().datetime().optional(),
  trialExpiresAt: z.string().datetime().optional(),
});

export type TransitionLeadInput = z.input<typeof transitionLeadInput>;

export type LeadMutationResult =
  | { kind: "ok"; leadId: string }
  | {
      kind: "error";
      code: "invalid" | "not_found" | "invalid_transition";
      message: string;
    };

export async function createLead(
  input: CreateLeadInput,
  ctx: { actorId: UserId },
): Promise<LeadMutationResult> {
  const parsed = createLeadInput.parse(input);
  return withPlatformAdmin(async (tx) => {
    const [row] = await tx
      .insert(platformLeads)
      .values({
        businessName: parsed.businessName,
        contactName: parsed.contactName,
        phone: parsed.phone,
        email: parsed.email ?? null,
        city: parsed.city ?? null,
        source: parsed.source,
        status: "lead",
        qualification: parsed.qualification ?? {},
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      })
      .returning({ id: platformLeads.id });
    if (!row) {
      return { kind: "error", code: "invalid", message: "Lead insert returned no row." };
    }
    await recordOpsAudit(tx, {
      action: "platform_lead.create",
      actorId: ctx.actorId,
      targetType: "platform_lead",
      targetId: row.id,
      after: {
        businessName: parsed.businessName,
        phone: parsed.phone,
        source: parsed.source,
      },
    });
    return { kind: "ok", leadId: row.id };
  });
}

export async function listLeads(): Promise<PlatformLead[]> {
  return withPlatformAdmin(async (tx) =>
    tx
      .select()
      .from(platformLeads)
      .orderBy(asc(platformLeads.status), desc(platformLeads.createdAt)),
  );
}

export async function getLead(leadId: string): Promise<PlatformLead | null> {
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, leadId))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function transitionLead(
  leadId: string,
  input: TransitionLeadInput,
  ctx: { actorId: UserId },
): Promise<LeadMutationResult> {
  const parsed = transitionLeadInput.parse(input);

  if (parsed.status === "lost" && !parsed.lostReason?.trim()) {
    return {
      kind: "error",
      code: "invalid",
      message: "A reason is required to mark a lead lost.",
    };
  }
  if (parsed.status === "trial" && !parsed.trialTenantId) {
    return {
      kind: "error",
      code: "invalid",
      message: "Marking a lead in trial requires the trial tenant.",
    };
  }

  return withPlatformAdmin(async (tx) => {
    const existingRows = await tx
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, leadId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return { kind: "error", code: "not_found", message: "Lead not found." };
    }

    await tx
      .update(platformLeads)
      .set({
        status: parsed.status,
        lostReason: parsed.lostReason?.trim() ?? null,
        opsOwnerId: parsed.opsOwnerId ?? existing.opsOwnerId,
        trialTenantId: (parsed.trialTenantId as TenantId | undefined) ??
          existing.trialTenantId,
        trialStartsAt: parsed.trialStartsAt
          ? new Date(parsed.trialStartsAt)
          : existing.trialStartsAt,
        trialExpiresAt: parsed.trialExpiresAt
          ? new Date(parsed.trialExpiresAt)
          : existing.trialExpiresAt,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(eq(platformLeads.id, leadId));

    await recordOpsAudit(tx, {
      action: "platform_lead.update",
      actorId: ctx.actorId,
      targetType: "platform_lead",
      targetId: leadId,
      before: { status: existing.status },
      after: { status: parsed.status },
      detail: parsed.lostReason ? { lostReason: parsed.lostReason } : {},
    });

    return { kind: "ok", leadId };
  });
}

// O-10 uses this to stamp a lead converted. Kept here so the
// converted-at/tenant pair is written by the same service that owns the
// rest of the lifecycle (and audited the same way).
export async function markLeadConverted(
  leadId: string,
  convertedTenantId: TenantId,
  ctx: { actorId: UserId },
): Promise<LeadMutationResult> {
  return withPlatformAdmin(async (tx) => {
    const existingRows = await tx
      .select({ status: platformLeads.status })
      .from(platformLeads)
      .where(eq(platformLeads.id, leadId))
      .limit(1);
    if (!existingRows[0]) {
      return { kind: "error", code: "not_found", message: "Lead not found." };
    }

    await tx
      .update(platformLeads)
      .set({
        status: "converted",
        convertedTenantId,
        convertedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(eq(platformLeads.id, leadId));

    await recordOpsAudit(tx, {
      action: "platform_lead.update",
      actorId: ctx.actorId,
      targetType: "platform_lead",
      targetId: leadId,
      before: { status: existingRows[0].status },
      after: { status: "converted", convertedTenantId },
    });

    return { kind: "ok", leadId };
  });
}

// Used by O-10's conversion and by tests: a duplicate phone is the
// common intake mistake, and the design's lifecycle starts from a real
// conversation, not a duplicate row.
export async function findLeadByPhone(phone: string): Promise<PlatformLead | null> {
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select()
      .from(platformLeads)
      .where(and(eq(platformLeads.phone, phone)))
      .orderBy(desc(platformLeads.createdAt))
      .limit(1);
    return rows[0] ?? null;
  });
}
