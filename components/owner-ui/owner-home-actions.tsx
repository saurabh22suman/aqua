import Link from "next/link";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import UserPlus from "lucide-react/dist/esm/icons/user-plus.mjs";
import { buttonClasses } from "@/components/ui/Button";

// Owner redesign · System lane — the owner Home action row.
//
// ONE dominant action: collect a payment. It goes to the real journey
// (Dues → open an invoice → record the payment), never to the
// transactions history, and it is only rendered when the caller holds
// the permission its destination enforces.
//
// The secondary action is quiet: a theme-tinted "Add <member>". The
// tertiary action is a plain link: "Capture <enquiry>". They are there
// because a club day includes them, and they are never dressed as
// competing with the one that matters.
//
// Every control here wears the shared control contract (48px, the 10px
// control radius, 16px control text) because the class list comes from
// the shared `buttonClasses()` — the row cannot drift away from the
// system's own controls.

export function OwnerHomeActions({
  collectHref,
  addMemberHref,
  captureEnquiryHref,
  memberLabel,
  enquiryLabel,
}: {
  collectHref: string | null;
  addMemberHref: string | null;
  captureEnquiryHref: string | null;
  memberLabel: string;
  enquiryLabel: string;
}) {
  if (!collectHref && !addMemberHref && !captureEnquiryHref) return null;
  return (
    <div
      data-testid="owner-home-actions"
      className="mt-4 flex flex-wrap items-center gap-2"
    >
      {collectHref ? (
        <Link
          href={collectHref}
          className={buttonClasses({ variant: "primary", size: "md" })}
        >
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          Collect payment
        </Link>
      ) : null}
      {addMemberHref ? (
        <Link
          href={addMemberHref}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
          Add {memberLabel}
        </Link>
      ) : null}
      {captureEnquiryHref ? (
        <Link
          href={captureEnquiryHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-ctl px-2 text-[16px] font-medium text-ink-2 motion-fast transition-colors hover:bg-deck hover:text-ink"
        >
          <ClipboardList size={16} className="text-ink-3" aria-hidden="true" />
          Capture {enquiryLabel}
        </Link>
      ) : null}
    </div>
  );
}
