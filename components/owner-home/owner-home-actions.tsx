import Link from "next/link";
import { ClipboardList, Plus, UserPlus } from "lucide-react";

// Owner Home — the actions.
//
// ONE dominant action: collect a payment. It goes to the real journey
// (Dues → open an invoice → record the payment), never to the
// transactions history, and it is only rendered when the caller holds
// the permission its destination enforces.
//
// The secondary actions are quiet: a tinted "Add member" and a plain
// "Capture enquiry". They are there because a club day includes them,
// and they are never dressed as competing with the one that matters.
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
          className="inline-flex min-h-[44px] items-center gap-2 rounded-ctl bg-[var(--accent-strong)] px-4 text-[13.5px] font-semibold text-white motion-fast transition-colors hover:bg-[var(--action-surface-hover)]"
        >
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          Collect payment
        </Link>
      ) : null}
      {addMemberHref ? (
        <Link
          href={addMemberHref}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-ctl bg-[var(--action-soft)] px-4 text-[13.5px] font-semibold text-[var(--action-ink)] motion-fast transition-colors hover:opacity-90"
        >
          <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
          Add {memberLabel}
        </Link>
      ) : null}
      {captureEnquiryHref ? (
        <Link
          href={captureEnquiryHref}
          className="inline-flex min-h-[44px] items-center gap-2 px-2 text-[13.5px] font-medium text-ink-2 motion-fast transition-colors hover:text-ink"
        >
          <ClipboardList size={16} className="text-ink-3" aria-hidden="true" />
          Capture {enquiryLabel}
        </Link>
      ) : null}
    </div>
  );
}
