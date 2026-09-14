"use server";

import { z } from "zod";
import { resolveConfigChangeRequest } from "@/db/config-requests";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { opsAction } from "@/db/ops-action";
import { asUserId } from "@/lib/ids";

// O-07 — ops resolution of an owner's change request, through the O-05
// audited pipeline. Parsed FormData so the ops viewer island can use
// <form action={...}> (H1: no pre-hydration GET leak).

const resolveFormInput = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["resolved", "declined"]),
  resolutionNote: z.string().trim().max(500).optional(),
  // The checkbox posts "on" when ticked; only a resolved decision
  // applies the value.
  applyValue: z.boolean().optional(),
});

export async function resolveConfigChangeRequestAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const surface = resolveFormInput.safeParse({
    requestId: String(formData.get("requestId") ?? ""),
    status: String(formData.get("status") ?? ""),
    resolutionNote:
      String(formData.get("resolutionNote") ?? "").trim() || undefined,
    applyValue: formData.get("applyValue") === "on",
  });
  if (!surface.success) {
    return {
      ok: false,
      error: surface.error.issues[0]?.message ?? "Invalid resolution.",
    };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }

  return opsAction(
    {
      scope: "config.request.resolve",
      actorId: asUserId(status.userId),
      targetType: "config_change_request",
      targetId: surface.data.requestId,
      reason: surface.data.resolutionNote,
    },
    () =>
      resolveConfigChangeRequest({
        requestId: surface.data.requestId,
        status: surface.data.status,
        resolutionNote: surface.data.resolutionNote,
        applyValue: surface.data.applyValue,
        actorId: asUserId(status.userId),
      }),
  );
}
