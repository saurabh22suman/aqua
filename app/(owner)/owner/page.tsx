import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { OwnerDashboard } from "@/components/owner-dashboard";

export default async function OwnerHomePage() {
  const data = await getOwnerDashboardAction();
  return <OwnerDashboard data={data} />;
}
