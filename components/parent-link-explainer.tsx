import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

// Shared by the legacy /parent page and its missing-page fallback.
export function ParentLinkExplainer() {
  return (
    <main className="mx-auto max-w-md px-5 pt-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-deck text-ink-3">
        <MessageCircle size={22} aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-[19px] font-semibold">
        Two ways to open your child&apos;s page
      </h1>
      <p className="mt-2 text-[13.5px] leading-snug text-ink-3">
        Use the sign-in or private link your club gave you.
      </p>

      <section
        aria-label="Family account"
        className="mt-5 rounded-card border border-line bg-paper p-4"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Family account
        </p>
        <h2 className="mt-1 text-[14px] font-medium text-ink">
          Sign in with your mobile number and PIN
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-3">
          If your club set up an Aqua account for your family, use the mobile
          number linked to your child&apos;s membership.
        </p>
        <Link
          href="/family/sign-in"
          className={buttonClasses({
            variant: "secondary",
            size: "md",
            className: "mt-3",
          })}
        >
          Family sign in
        </Link>
      </section>

      <section
        aria-label="Club link"
        className="mt-3 rounded-card border border-line bg-paper p-4"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Club link
        </p>
        <h2 className="mt-1 text-[14px] font-medium text-ink">
          Open the private link from your club
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-3">
          Look for your club&apos;s WhatsApp message or ask the club to resend
          the link. It opens directly on your phone without a sign-in.
        </p>
      </section>

      <p className="mt-4 text-[12.5px] leading-snug text-ink-3">
        Anyone who has the link can open the page until it expires. Keep it
        within your family.
      </p>

      <section
        aria-label="Club staff"
        className="mt-6 border-t border-line pt-4"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Club staff
        </p>
        <Link
          href="/login"
          className={buttonClasses({
            variant: "secondary",
            size: "md",
            className: "mt-2",
          })}
        >
          Staff sign in
        </Link>
      </section>
    </main>
  );
}
