import { TenantSignOut } from "@/components/tenant-sign-out";
import { PersonAvatar } from "@/components/avatar";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { TransientDisclosure } from "@/components/ui/TransientDisclosure";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";

// Owner Home — the account control on a phone.
//
// The desktop account row belongs to the shared shell (the sidebar, as
// the approved design has it). A phone has no sidebar, so the phone
// keeps the account control in the page header — the same affordance,
// in the one place it is reachable, never on screen twice at once
// (the shell's row is a desktop-only surface).
//
// It is a native <details>, so it opens and closes with no JavaScript,
// and the sign-out inside it is the shared, offline-safe control. The
// shared transient surface adds the menu dismissal around it: a press
// outside, the focus leaving, Escape, the route changing or another
// surface opening closes it — without touching the sign-out.
//
// The mark is the SIGNED-IN PERSON's initials, drawn by the shared
// PersonAvatar (the displayed name's graphemes on the theme tint). It is
// never the club's branding initials: an account control is a person,
// and the academy mark is branding (DESIGN.md §Account controls and the
// name-initials rule). A signed-in user whose name is not on file — an
// owner who was never entered as a person — draws the shared primitive's
// honest unknown ("?"), never another identity's letters.
export function OwnerAccountControl({
  className = "",
  accountName = null,
  tenantId,
}: {
  className?: string;
  /** The signed-in person's display name. */
  accountName?: string | null;
  tenantId?: string;
}) {
  return (
    <TransientDisclosure
      className={`relative ${className}`}
      triggerClassName="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-ctl border border-line bg-paper text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      trigger={
        <>
          <PersonAvatar name={accountName ?? ""} size={32} className="flex-none" />
          <span className="sr-only">Account</span>
        </>
      }
    >
      <div className="absolute right-0 z-40 mt-1 w-52 rounded-ctl border border-line bg-paper p-2 shadow-2">
        <Link href="/owner/settings/appearance" className="flex min-h-11 items-center rounded-ctl px-3 text-sm text-ink hover:bg-deck">Appearance</Link>
        {tenantId ? <div className="px-3"><StaffClubInstallLink tenantId={tenantId} /></div> : null}
        <TenantSignOut className="mt-0" />
      </div>
    </TransientDisclosure>
  );
}
