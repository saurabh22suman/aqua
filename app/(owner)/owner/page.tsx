import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { OwnerDashboard } from "@/components/owner-dashboard";

export default async function OwnerHomePage() {
  const [data, branding] = await Promise.all([
    getOwnerDashboardAction(),
    getBrandingAction(),
  ]);
  return <OwnerDashboard data={data} branding={branding} />;
}
