import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";

export default async function OwnerOnboardingPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.read");
  const data = await getOnboardingChecklistAction();
  return <OnboardingChecklistView data={data} guideKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)} />;
}
