import { z } from "zod";
import { GSTIN_RE, GST_STATE_NAMES } from "@/lib/gst";

const name = z.string().trim().min(1).max(200)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "Use a single line of text.");
const stateCode = z.string().regex(/^\d{2}$/).refine((value) => value in GST_STATE_NAMES);
const gstin = z.string().trim().toUpperCase().regex(GSTIN_RE);
export const billingAddressSchema = z.strictObject({
  line1: name,
  line2: name.nullable(),
  city: name,
  postalCode: z.string().trim().regex(/^[1-9]\d{5}$/),
});
export const saveClubBillingDefaultSchema = z.strictObject({
  legalName: name.nullable(),
  legalAddress: billingAddressSchema.nullable(),
  stateCode: stateCode.nullable(),
  gstin: gstin.nullable(),
});
export const siteBillingChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("inherit") }),
  z.strictObject({ mode: z.literal("registered_override"), registrationId: z.string().uuid() }),
  z.strictObject({ mode: z.literal("unregistered_override"), legalName: name, legalAddress: billingAddressSchema }),
]);
export const saveSiteBillingSettingSchema = z.strictObject({
  locationId: z.string().uuid(),
  stateCode,
  choice: siteBillingChoiceSchema,
  enable: z.boolean(),
});
export const resetSiteBillingSettingSchema = z.strictObject({ locationId: z.string().uuid() });
export const createBillingRegistrationSchema = z.strictObject({
  legalName: name,
  legalAddress: billingAddressSchema,
  stateCode,
  gstin,
});

export type BillingAddress = z.infer<typeof billingAddressSchema>;
export type BillingIssuer = { legalName: string; legalAddress: BillingAddress; stateCode: string; gstin: string | null };
export type BillingErrorCode = "invalid" | "owner_required" | "not_found" | "incomplete_issuer" | "state_mismatch" | "open_orders" | "already_enabled" | "cannot_disable" | "conflict";
export type BillingResult<T> = { ok: true; value: T } | { ok: false; code: BillingErrorCode; message: string };
export type ClubBillingDefault = z.infer<typeof saveClubBillingDefaultSchema>;
export type SaveClubBillingDefaultInput = ClubBillingDefault;
export type SiteBillingChoice = z.infer<typeof siteBillingChoiceSchema>;
export type SiteBillingSetting = {
  locationId: string;
  locationName: string;
  enabled: boolean;
  stateCode: string | null;
  choice: SiteBillingChoice;
  effectiveIssuer: BillingIssuer | null;
  registrations: Array<{ id: string; issuer: BillingIssuer }>;
};
export type SaveSiteBillingSettingInput = z.infer<typeof saveSiteBillingSettingSchema>;
export type ResetSiteBillingSettingInput = z.infer<typeof resetSiteBillingSettingSchema>;
export type CreateBillingRegistrationInput = z.infer<typeof createBillingRegistrationSchema>;
