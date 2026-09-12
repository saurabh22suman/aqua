import Link from "next/link";
import { MessageCircle } from "lucide-react";

// W1-3 (docs/role-surfaces-plan.md) — /parent used to render a bare
// `<h1>Parent</h1>`. Parents do not have accounts (scope §3.3: no app,
// no install); their real surface is the signed /p/[token] link the
// club shares on WhatsApp. This page tells them that plainly instead
// of showing a dead end. Workers also land here as a placeholder home
// until a worker surface exists, and the copy stays true for them too.
export default function ParentPage() {
  return (
    <main className="px-5 pt-16 max-w-md mx-auto">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-water-soft text-water">
        <MessageCircle size={22} aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-[19px] font-semibold">
        Parents get their link from the club
      </h1>
      <p className="mt-2 text-[13.5px] text-ink-3 leading-snug">
        Your academy shares a private link on WhatsApp — it opens your
        child&apos;s attendance, next session and updates. No app, no
        password, no account needed.
      </p>
      <p className="mt-4 text-[13px] text-ink-3 leading-snug">
        Don&apos;t have it yet? Ask your academy to send it again.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex items-center justify-center rounded-pill min-h-[44px] px-5 py-3 text-[14px] font-semibold text-paper bg-[var(--accent)]"
      >
        Staff sign in
      </Link>
    </main>
  );
}
