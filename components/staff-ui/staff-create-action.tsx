import Link from "next/link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

// Staff UI — the one contextual create action.
//
// It appears only on a page whose role is actually authorised to create
// and whose destination exists. It is a single round 56px control above
// the bottom navigation, clear of the safe area; the page that carries
// it reserves the extra bottom room (DESIGN.md's create-action rule).
// The visible glyph is the approved outline plus; the accessible name
// is the label the action performs.
export const STAFF_CREATE_ACTION_TESTID = "staff-create-action";

export function StaffCreateAction({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      data-testid={STAFF_CREATE_ACTION_TESTID}
      data-staff-create
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 1rem)" }}
      className="fixed right-4 z-20 grid h-14 w-14 place-items-center rounded-full bg-[var(--accent-strong)] text-white shadow-2 transition-colors duration-150 hover:bg-[var(--action-surface-hover)] active:opacity-90 lg:hidden"
    >
      <OwnerIcon name="plus" size={24} />
    </Link>
  );
}
