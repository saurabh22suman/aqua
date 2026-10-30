import UserRound from "lucide-react/dist/esm/icons/user-round.mjs";
import { TenantSignOut } from "@/components/tenant-sign-out";

// Owner Home — the account control on a phone.
//
// The desktop account row belongs to the shared shell (the sidebar, as
// the approved design has it). A phone has no sidebar, so the phone
// keeps the account control in the page header — the same affordance,
// in the one place it is reachable, never on screen twice at once
// (the shell's row is a desktop-only surface).
//
// It is a native <details>, so it opens and closes with no JavaScript,
// and the sign-out inside it is the shared, offline-safe control.
export function OwnerAccountControl({
  className = "",
  initials = null,
}: {
  className?: string;
  /** The club initials shown on the reference header avatar. */
  initials?: string | null;
}) {
  return (
    <details className={`relative ${className}`}>
      <summary className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-ctl border border-line bg-paper text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
        {initials ? (
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--accent-soft)] font-display text-[11px] font-semibold text-[var(--accent-ink)]"
          >
            {initials}
          </span>
        ) : (
          <UserRound size={18} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span className="sr-only">Account</span>
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-52 rounded-ctl border border-line bg-paper p-2 shadow-2">
        <TenantSignOut className="mt-0" />
      </div>
    </details>
  );
}
