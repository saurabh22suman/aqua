import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { listClubChoices } from "@/db/club-selection";
import { activeClubFromHeaders } from "@/lib/auth/active-club";
import { ClubChoice } from "@/components/club-choice";
import { LoginWelcome } from "@/components/auth/login-welcome";
import { TenantSignOut } from "@/components/tenant-sign-out";

export default async function ClubsPage({ searchParams }: { searchParams?: Promise<{ unavailable?: string }> }) {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) redirect("/login");
  const choices = await listClubChoices(session.user.id,new Date(session.session.createdAt));
  const unavailable = (await searchParams)?.unavailable === "1";
  return (
    <LoginWelcome>
      <h1>Choose a business account</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">Choose the business you’re working for. You can view all your permitted facilities together once you’re inside.</p>
      {unavailable ? <p role="alert" className="mt-3 text-sm text-ink-2">That workspace is no longer available. Choose one of your current business accounts.</p> : null}
      {choices.length ? <ClubChoice choices={choices} current={activeClubFromHeaders(h)} /> : (
        <p role="status" className="mt-6 text-ink-2">No business accounts are available. Sign in again or contact your account owner.</p>
      )}
      <TenantSignOut className="mt-6" showClubSwitch={false} />
    </LoginWelcome>
  );
}
