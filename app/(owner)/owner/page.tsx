import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { OwnerDashboard } from "@/components/owner-dashboard";

export default async function OwnerHomePage() {
  const [data, branding, terminology] = await Promise.all([
    getOwnerDashboardAction(),
    getBrandingAction(),
    getTerminologyAction(),
  ]);
  return (
    <OwnerDashboard
      data={data}
      branding={branding}
      terminology={terminology}
    />
  );
}
