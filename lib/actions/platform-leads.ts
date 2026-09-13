"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createLead,
  transitionLead,
  type LeadMutationResult,
} from "@/db/platform-leads";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { opsAction } from "@/db/ops-action";
import { asUserId } from "@/lib/ids";

// O-09 (docs/ops-platform-design.md §7) — ops console actions for the
// sales pipeline. Same preamble as every platform action: (1) parse,
// (2) platform-session check, then (3) the audited ops pipeline.

const createLeadFormInput = z.object({
  businessName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(5).max(40),
  city: z.string().trim().max(120).optional(),
  source: z.enum(["website", "phone", "whatsapp", "referral", "other"]),
  sport: z.string().trim().max(80).optional(),
  memberCountBand: z.enum(["<50", "50-150", "150-400", "400+"]).optional(),
  feeModel: z.enum(["monthly", "per_hour", "both", "unknown"]).optional(),
  collectionMode: z.enum(["cash", "upi", "both", "unknown"]).optional(),
  gstRegistered: z.boolean().optional(),
  coachCount: z.number().int().min(0).max(500).optional(),
  locations: z.number().int().min(1).max(50).optional(),
});

export async function createLeadAction(
  _prev: unknown,
  formData: FormData,
): Promise<LeadMutationResult> {
  const coachCountRaw = String(formData.get("coachCount") ?? "").trim();
  const locationsRaw = String(formData.get("locations") ?? "").trim();

  const surface = createLeadFormInput.safeParse({
    businessName: String(formData.get("businessName") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim() || undefined,
    source: String(formData.get("source") ?? ""),
    sport: String(formData.get("sport") ?? "").trim() || undefined,
    memberCountBand: String(formData.get("memberCountBand") ?? "") || undefined,
    feeModel: String(formData.get("feeModel") ?? "") || undefined,
    collectionMode: String(formData.get("collectionMode") ?? "") || undefined,
    gstRegistered: formData.get("gstRegistered") === "on" ? true : undefined,
    coachCount: coachCountRaw ? Number(coachCountRaw) : undefined,
    locations: locationsRaw ? Number(locationsRaw) : undefined,
  });
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid lead input.",
    };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  const { businessName, contactName, phone, city, source, ...qualification } =
    surface.data;

  const result = await opsAction(
    {
      scope: "platform_lead.create",
      actorId: asUserId(status.userId),
      targetType: "platform_lead",
      detail: { source },
    },
    () =>
      createLead(
        { businessName, contactName, phone, city, source, qualification },
        { actorId: asUserId(status.userId) },
      ),
  );
  if (result.kind === "ok") {
    revalidatePath("/ops/leads");
  }
  return result;
}

const transitionLeadFormInput = z.object({
  status: z.enum([
    "lead",
    "qualified",
    "demo_booked",
    "trial",
    "lapsed",
    "lost",
  ]),
  lostReason: z.string().trim().max(500).optional(),
  trialTenantId: z.string().uuid().optional(),
  trialStartsAt: z.string().datetime().optional(),
  trialExpiresAt: z.string().datetime().optional(),
});

export async function transitionLeadAction(
  leadId: string,
  input: unknown,
): Promise<LeadMutationResult> {
  const surface = transitionLeadFormInput.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid transition.",
    };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  const result = await opsAction(
    {
      scope: "platform_lead.update",
      actorId: asUserId(status.userId),
      targetType: "platform_lead",
      detail: { status: surface.data.status },
    },
    () =>
      transitionLead(leadId, surface.data, {
        actorId: asUserId(status.userId),
      }),
  );
  if (result.kind === "ok") {
    revalidatePath(`/ops/leads/${leadId}`);
  }
  return result;
}
