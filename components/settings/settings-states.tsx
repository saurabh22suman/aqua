import { OwnerLink as Link } from "@/components/owner-ui/owner-link";

// Settings task states shared by the Owner settings subpages.
//
// Two shapes were repeated by hand: a read that failed (which is not an
// empty list and must offer the same route again) and a prerequisite that
// blocks the task the page exists for. Keeping them here means the copy,
// target height and recovery path do not drift between routes.

export function SettingsReadError({
  message,
  retryHref,
  retryLabel = "Try again",
}: {
  message: string;
  retryHref: string;
  retryLabel?: string;
}) {
  return (
    <>
      <p role="alert" className="mt-4 max-w-[65ch] text-[14px] text-ink-2">
        {message}
      </p>
      <Link
        href={retryHref}
        className="mt-3 inline-flex min-h-12 items-center text-[var(--accent-ink)] underline"
      >
        {retryLabel}
      </Link>
    </>
  );
}

export function SettingsPrerequisite({
  title,
  body,
  actionLabel,
  actionHref,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <section
      data-testid="settings-prerequisite"
      className="mt-4 max-w-[65ch] rounded-card border border-line bg-paper p-4 text-[13px] text-ink-2"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1">{body}</p>
      <Link
        href={actionHref}
        className="mt-2 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2"
      >
        {actionLabel}
      </Link>
    </section>
  );
}
