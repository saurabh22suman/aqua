import { z } from "zod";
import { pinSchema } from "@/lib/services/credentials";

export type WhatsAppAuthState = { step: "phone" | "code" | "pin" | "done"; error?: string; notice?: string };
export const whatsappAuthInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("request"), phone: z.string().trim().min(5).max(40) }),
  z.object({ intent: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ intent: z.literal("save"), pin: pinSchema, confirmPin: pinSchema })
    .refine((v) => v.pin === v.confirmPin, "The PINs do not match."),
]);
