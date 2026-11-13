import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { listClubChoices } from "@/db/club-selection";
import { activeClubFromHeaders } from "@/lib/auth/active-club";
import { ClubChoice } from "@/components/club-choice";
import { PageHeader } from "@/components/ui/PageHeader";
import { TenantSignOut } from "@/components/tenant-sign-out";

export default async function ClubsPage() {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) redirect("/login");
  const choices = await listClubChoices(session.user.id,new Date(session.session.createdAt));
  return <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-8">
    <PageHeader title="Choose your club" purpose="Your role, facilities and records belong to the club you select." />
    {choices.length ? <ClubChoice choices={choices} current={activeClubFromHeaders(h)} /> :
      <p role="status" className="mt-6 text-base text-ink-2">No clubs are available for this session. Sign in again or contact your club owner.</p>}
    <TenantSignOut className="mt-6" showClubSwitch={false} />
  </main>;
}
