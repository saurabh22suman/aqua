import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";

export default async function OwnerOnboardingPage() {
  const data = await getOnboardingChecklistAction();
  return <OnboardingChecklistView data={data} />;
}
