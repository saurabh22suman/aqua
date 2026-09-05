"use server";

import { z } from "zod";
import { inviteOwner, type InviteOwnerResult } from "@/db/tenant-invite";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 2.7 — server action for the "invite the owner" wizard
// step. Standing-rule pattern: (1) parse the surface input, (2)
// check the platform session, (3) call the service. The result
// kind drives the inline UI:
//   - 'ok'             → router.refresh; the membership appears in
//                          the tenant's roster
//   - 'invalid'        → inline error pill, surface-level failure
//   - 'tenant_not_found' / 'owner_role_missing' / 'already_member'
//                      → same path, defensive failure
//   - 'error'          → last-resort branch
//
// H1 — input is now FormData (the form uses <form action={fn}>
// rather than onSubmit). tenantId arrives as a hidden field; the
// server re-parses and re-validates it so a tampered field cannot
// address a different tenant.

const inviteFormInput = z.object({
  tenantId: z.string().uuid(),
  phone: z.string().trim().min(1).max(40),
});

export type InviteOwnerActionResult =
  | InviteOwnerResult
  | { kind: "error"; code: "invalid"; message: string };

export async function inviteOwnerAction(
  _prev: unknown,
  formData: FormData,
): Promise<InviteOwnerActionResult> {
  // (1) parse
  const surface = inviteFormInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Pick a tenant and a phone number.",
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
  return inviteOwner(surface.data.tenantId as never, {
    phone: surface.data.phone,
    actorId: asUserId(status.userId),
  });
}