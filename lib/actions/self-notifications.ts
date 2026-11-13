"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { markSelfNotificationReadInTx } from "@/lib/services/announcements";

export async function markSelfNotificationAction(audience: "member" | "guardian", form: FormData) {
  const parsed = z.object({ audience: z.enum(["member", "guardian"]), notificationId: z.string().uuid() }).safeParse({ audience, notificationId: form.get("notificationId") });
  if (!parsed.success) notFound();
  const resolver = await resolveSelfScope(parsed.data.audience, null);
  if (!resolver) notFound();
  const result = await resolver.read((tx, scope) => markSelfNotificationReadInTx(tx, scope, parsed.data.notificationId));
  if (!result.ok) notFound();
  revalidatePath(parsed.data.audience === "member" ? "/member/announcements" : "/family/announcements");
}
