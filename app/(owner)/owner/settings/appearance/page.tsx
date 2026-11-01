import { requireOwner } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default async function OwnerAppearancePage() {
  const ctx = await requireOwner();
  return <OwnerPage><PageHeader title="Appearance" purpose="Choose a theme and artwork for your workspace." /><div className="mt-5"><ThemeToggle /><div className="mt-5"><OwnerArtwork mode="chooser" identity={{ tenantId: ctx.tenantId, userId: ctx.userId }} /></div></div></OwnerPage>;
}
