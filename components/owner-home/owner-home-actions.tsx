import Link from "next/link";
import { KhelIcon, type KhelIconName } from "@/components/icons/khel-icons";

export function OwnerHomeActions({ collectHref, addMemberHref, captureEnquiryHref, bookingHref, memberLabel, enquiryLabel }: {
  collectHref: string | null; addMemberHref: string | null; captureEnquiryHref: string | null;
  bookingHref?: string | null; memberLabel: string; enquiryLabel: string;
}) {
  const actions: { href: string | null | undefined; label: string; icon: KhelIconName; surface: string }[] = [
    { href: addMemberHref, label: `Add ${memberLabel}`, icon: "members", surface: "var(--owner-action-members)" },
    { href: collectHref, label: "Record payment", icon: "collect-payment", surface: "var(--owner-action-payment)" },
    { href: bookingHref, label: "Book a slot", icon: "bookings", surface: "var(--owner-action-booking)" },
    { href: captureEnquiryHref, label: enquiryLabel, icon: "enquiries", surface: "var(--owner-action-enquiry)" },
  ];
  if (!actions.some(action => action.href)) return null;
  return <section data-testid="owner-home-actions" className="mt-3 rounded-card border border-line bg-paper p-4" aria-labelledby="owner-quick-actions-heading">
    <h2 id="owner-quick-actions-heading" className="font-display text-base font-semibold">Quick actions</h2>
    <div className="mt-3 grid grid-cols-4 gap-1">
      {actions.filter(action => action.href).map(action => <Link key={action.label} href={action.href!} className="flex min-w-0 flex-col items-center gap-1 rounded-ctl px-1 py-1 text-center text-xs font-medium text-ink hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
        <span className="grid h-10 w-10 place-items-center rounded-ctl" style={{ backgroundColor: action.surface }}><KhelIcon name={action.icon} size={20} /></span><span>{action.label}</span>
      </Link>)}
    </div>
  </section>;
}
