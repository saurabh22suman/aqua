"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  removeSampleData,
  type RemoveSampleDataResult,
} from "@/db/preset-sample-data";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// Phase 2.3 — server action for the "Remove sample data" button.
// H1 — input is now FormData; tenantId arrives as a hidden field
// (re-validated server-side).

const removeFormInput = z.object({
  tenantId: z.string().uuid(),
});

export type RemoveSampleDataActionResult =
  | RemoveSampleDataResult
  | { kind: "error"; code: "invalid"; message: string };

export async function removeSampleDataAction(
  _prev: unknown,
  formData: FormData,
): Promise<RemoveSampleDataActionResult> {
  // (1) parse
  const surface = removeFormInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
  });
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Invalid tenant reference.",
    };
  }

  // (2) platform-session permission check
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  // (3) service
  const result = await removeSampleData(surface.data.tenantId as never, {
    actorId: status.userId as never,
  });
  if (result.kind === "ok") {
    revalidatePath(`/platform/tenants/${surface.data.tenantId}`);
  }
  return result;
}