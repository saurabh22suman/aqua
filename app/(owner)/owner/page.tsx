import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { requireOwner } from "@/lib/auth/surface-guard";

export default async function OwnerHomePage() {
  await requireOwner();
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
