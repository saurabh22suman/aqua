import { ClubMark } from "@/components/branding/club-mark";

/** Orientation only: authorization and facility scope remain server-owned. */
export function StaffClubContext({ clubName, clubLogoUrl, roleLabel, siteLabel }: { clubName: string; clubLogoUrl?: string | null; roleLabel?: string; siteLabel?: string }) {
  const role = roleLabel ? roleLabel[0]!.toUpperCase() + roleLabel.slice(1) : undefined;
  return <div className="flex min-w-0 items-center gap-2 px-4 pt-3 text-[13px] font-medium text-ink-2" aria-label={`Club: ${clubName}`}><ClubMark name={clubName} logoUrl={clubLogoUrl} /><span className="min-w-0 break-words"><span className="block">{clubName}</span>{role || siteLabel ? <span className="block text-xs font-normal">{[role, siteLabel].filter(Boolean).join(" · ")}</span> : null}</span></div>;
}
