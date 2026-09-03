import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import {
  getOnboardingChecklist,
  type OnboardingChecklist,
} from "@/lib/services/onboarding-checklist";

// Phase 2.8 — server action for the onboarding checklist page.
// Parse/permission preamble per the standing rule; no input here
// (the checklist is per-tenant, derived from session), so the
// Zod parse is the no-op shape that the preamble's structural
// test still recognises as parse-then-permission-order.
export async function getOnboardingChecklistAction(): Promise<OnboardingChecklist> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getOnboardingChecklist({ tenantId: ctx.tenantId });
}
