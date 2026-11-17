import Link from "next/link";

/** The destination independently rechecks the current staff member's authority. */
export function StaffClubInstallLink({ tenantId }: { tenantId: string }) {
  return <Link href={`/clubs/${encodeURIComponent(tenantId)}/install?source=staff`} className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline underline-offset-2">Install this club</Link>;
}
