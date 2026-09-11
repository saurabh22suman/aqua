import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import { requireOwner } from "@/lib/auth/surface-guard";

export default async function OwnerOnboardingPage() {
  await requireOwner();
  const data = await getOnboardingChecklistAction();
  return <OnboardingChecklistView data={data} />;
}
