import { ClubMark } from "@/components/branding/club-mark";

/** Orientation only: authorization and facility scope remain server-owned. */
export function StaffClubContext({ clubName, clubLogoUrl }: { clubName: string; clubLogoUrl?: string | null }) {
  return <div className="flex min-w-0 items-center gap-2 px-4 pt-3 text-[13px] font-medium text-ink-2" aria-label={`Club: ${clubName}`}><ClubMark name={clubName} logoUrl={clubLogoUrl} /><span className="min-w-0 break-words">{clubName}</span></div>;
}
