import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isOpsHost } from "@/lib/ops-host";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetManifestData } from "@/lib/services/branding-target-asset";

export const dynamic = "force-dynamic";

/** Launcher never changes a club cookie; all view choices are reauthorized. */
export default async function TenantLaunchPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const h = await headers();
  if (isOpsHost(h.get("host")) || !z.string().uuid().safeParse(tenantId).success) notFound();
  const [staff, member, guardian] = await Promise.all([
    readAuthorizedBrandingTarget(tenantId, "staff", (tx) => readTargetManifestData(tx, tenantId)),
    readAuthorizedBrandingTarget(tenantId, "member", (tx) => readTargetManifestData(tx, tenantId)),
    readAuthorizedBrandingTarget(tenantId, "guardian", (tx) => readTargetManifestData(tx, tenantId)),
  ]);
  const club = staff ?? member ?? guardian;
  return <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
    <h1 className="break-words font-display text-2xl font-semibold text-ink">{club ? `Open ${club.name}` : "Open your club"}</h1>
    {staff || member || guardian ? <>
      <p className="mt-4 text-base text-ink-2">Choose how you want to continue.</p>
      <ul className="mt-4 space-y-3">
        {staff ? <li><Link href="/clubs" className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Choose a staff club</Link></li> : null}
        {member ? <li><Link href="/member" className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Open member view</Link></li> : null}
        {guardian ? <li><Link href="/family" className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Open family view</Link></li> : null}
      </ul>
    </> : <>
      <p className="mt-4 text-base text-ink-2">Your access could not be confirmed. Sign in again or contact your club.</p>
      <ul className="mt-4 space-y-3">
        <li><Link href="/login" className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Staff sign in</Link></li>
        <li><Link href={`/member/sign-in?clubId=${tenantId}`} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Member sign in</Link></li>
        <li><Link href={`/family/sign-in?clubId=${tenantId}`} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Family sign in</Link></li>
      </ul>
    </>}
  </main>;
}
