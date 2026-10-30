import Link from "next/link";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import UserPlus from "lucide-react/dist/esm/icons/user-plus.mjs";

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
      className="mt-4 flex flex-wrap items-center gap-2.5"
    >
      {collectHref ? (
        <Link
          href={collectHref}
          className="inline-flex min-h-12 items-center justify-center rounded-ctl bg-[var(--accent-strong)] px-4 text-[16px] font-medium text-white motion-fast transition-colors hover:bg-[var(--action-surface-hover)]"
        >
          Collect payment
        </Link>
      ) : null}
      {addMemberHref ? (
        <Link
          href={addMemberHref}
          className="hidden min-h-11 items-center gap-1.5 rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface-action)] px-3 text-[14px] font-medium text-[var(--accent-ink)] motion-fast transition-colors hover:bg-[var(--control-surface-action-hover)] lg:inline-flex"
        >
          <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
          Add {memberLabel}
        </Link>
      ) : null}
      {captureEnquiryHref ? (
        <Link
          href={captureEnquiryHref}
          className="hidden min-h-11 items-center gap-1.5 px-1.5 text-[14px] font-medium text-[var(--accent-ink)] motion-fast transition-colors hover:underline lg:inline-flex"
        >
          <ClipboardList size={16} aria-hidden="true" />
          Capture {enquiryLabel}
        </Link>
      ) : null}
    </div>
  );
}
