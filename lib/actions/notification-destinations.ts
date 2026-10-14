"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getNotificationDestinations, saveNotificationDestinations } from "@/lib/services/notification-destinations";

export async function getNotificationDestinationsAction(raw: string) {
  const memberId = z.string().uuid().parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return getNotificationDestinations(ctx, memberId);
}

export async function saveNotificationDestinationsAction(raw: { memberId: string; personIds: string[] }) {
  const input = z.object({ memberId: z.string().uuid(), personIds: z.array(z.string().uuid()).max(20) }).parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  const result = await saveNotificationDestinations(ctx, input.memberId, input.personIds);
  if (result.ok) {
    revalidatePath(`/owner/members/${input.memberId}`);
    revalidatePath(`/reception/members/${input.memberId}`);
  }
  return result;
}
