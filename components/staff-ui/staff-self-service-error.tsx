import { buttonClasses } from "@/components/ui/Button";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";

// finish/staff — the self-service read boundary.
//
// The Me surfaces put the caller's own shifts, attendance and leave on
// one page. A failed read used to leave the route to the global error
// boundary. Worse, substituting empty arrays would print "No published
// shifts" / "Not checked in yet" — empty, not unknown. Each section now
// settles on its own and states exactly what was not read, with a
// native retry back to that section. The whole-block card remains for
// the case where every section failed. Neither card carries a capability.

export function StaffSelfServiceError({ retryHref, message = "Could not load your work details. Your shifts, attendance and leave were not read, so nothing here is shown as empty." }: {
  retryHref: string;
  message?: string;
}) {
  return (
    <section
      aria-labelledby="staff-self-service-unavailable"
      className={`mt-4 p-4 ${STAFF_CARD}`}
      data-testid="staff-self-service-error"
    >
      <h2
        id="staff-self-service-unavailable"
        className="text-[15px] font-medium text-ink"
      >
        Your work details are unavailable
      </h2>
      <p role="alert" className="mt-1 text-[13px] leading-snug text-ink-2">
        {message}
      </p>
      <a
        href={retryHref}
        className={buttonClasses({
          variant: "secondary",
          size: "sm",
          className: "mt-3",
        })}
      >
        Retry work details
      </a>
    </section>
  );
}

export type StaffSectionErrorProps = {
  /** The stable page-local anchor the retry link returns to. */
  sectionId: "today-attendance" | "my-shifts" | "my-leave";
  title: string;
  message: string;
  retryHref: string;
  retryLabel: string;
};

/** One failed section, stated in place while the other sections stay usable. */
export function StaffSectionError({
  sectionId,
  title,
  message,
  retryHref,
  retryLabel,
}: StaffSectionErrorProps) {
  const headingId = `${sectionId}-unavailable`;

  return (
    <section
      id={sectionId}
      aria-labelledby={headingId}
      data-testid={`${sectionId}-unavailable`}
      className={`mt-4 scroll-mt-4 p-4 ${STAFF_CARD}`}
    >
      <h2 id={headingId} className="text-[15px] font-medium text-ink">
        {title}
      </h2>
      <p role="alert" className="mt-1 text-[13px] leading-snug text-ink-2">
        {message}
      </p>
      <a
        href={retryHref}
        className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
      >
        {retryLabel}
      </a>
    </section>
  );
}
