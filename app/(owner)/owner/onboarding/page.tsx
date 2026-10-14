import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";

export default async function OwnerOnboardingPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.read");
  const data = await getOnboardingChecklistAction();
  return <OnboardingChecklistView data={data} />;
}
