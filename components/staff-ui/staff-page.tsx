import type { HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";
import { PersonAvatar } from "@/components/avatar";
import { formatPhoneIN } from "@/lib/phone";

// Staff UI — the one role-only frame for coach, reception and worker.
//
// The approved Owner light language is the source of truth for type,
// spacing and icon geometry. Staff surfaces are mobile-first: a phone
// reads at a bounded measure, and a wide screen keeps that same measure
// instead of stretching to the window edge. This frame carries no data,
// no capability and no permission decision; it is layout only.
//
// The card radius is 16px (`rounded-2xl`), matching the approved owner
// card, while controls keep the shared 10px control radius. Headings use
// Instrument Sans 500 (the shared 400 face is the body): the staff tree
// never asks for the heavy display face.

export function StaffPage({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-staff-page
      className={cn(
        "mx-auto w-full max-w-2xl px-4 pb-8 pt-5 lg:max-w-3xl lg:px-6 lg:pt-6",
        className,
      )}
      {...rest}
    >
      {children}
    </main>
  );
}

export type StaffPageHeaderProps = {
  title: ReactNode;
  /** One scope line: the day, the count, or where the reader is. */
  meta?: ReactNode;
  /** A quiet page-level control (never a second dominant action). */
  action?: ReactNode;
};

export function StaffPageHeader({ title, meta, action }: StaffPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {meta ? (
          <p className="mt-1 text-[13px] leading-snug text-ink-3">{meta}</p>
        ) : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </header>
  );
}

export type StaffSectionProps = {
  title?: ReactNode;
  /** A right-aligned fact about this section (count/state), stated once. */
  meta?: ReactNode;
  /** A quiet action owned by this section. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function StaffSection({
  title,
  meta,
  action,
  className,
  children,
}: StaffSectionProps) {
  return (
    <section className={cn("mt-6", className)}>
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium leading-tight text-ink">
            {title}
          </h2>
          {meta ? (
            <span className="flex-none text-[12px] text-ink-3">{meta}</span>
          ) : null}
        </div>
      ) : null}
      {action ? <div className="mt-2 flex justify-end">{action}</div> : null}
      {children}
    </section>
  );
}

export type StaffNavCardProps = {
  href: string;
  icon: OwnerIconName;
  label: string;
  description: string;
  /** Stable hook for a consumer's own regression check. */
  testId?: string;
};

/**
 * A neutral destination card. The icon sits on the quiet deck chip and
 * the words carry the meaning; no semantic status colour is borrowed
 * for a destination.
 */
export function StaffNavCard({
  href,
  icon,
  label,
  description,
  testId,
}: StaffNavCardProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3 transition-colors duration-150 hover:bg-deck/60 active:bg-deck"
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
        <OwnerIcon name={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-tight text-ink">
          {label}
        </span>
        <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">
          {description}
        </span>
      </span>
      <OwnerIcon name="chevron" size={18} className="flex-none text-ink-3" />
    </Link>
  );
}

/** The shared card surface for a staff summary or identity block. */
export const STAFF_CARD = "rounded-2xl border border-line bg-paper";

export type StaffIdentityProps = {
  /** The displayed name. Missing is an honest unknown, never invented. */
  name?: string | null;
  phone?: string | null;
};

/**
 * The signed-in person's own identity. The initials come from the name
 * this block already shows; an unnamed account keeps the shared honest
 * "?" and says so in words.
 */
export function StaffIdentity({ name, phone }: StaffIdentityProps) {
  return (
    <div
      data-testid="staff-identity"
      className={`mt-4 flex items-center gap-3 p-4 ${STAFF_CARD}`}
    >
      <PersonAvatar name={name ?? ""} size={44} className="flex-none" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-tight text-ink">
          {name ?? "Name not on file"}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-tight text-ink-3">
          {phone ? formatPhoneIN(phone) : "No phone on file"}
        </p>
      </div>
    </div>
  );
}
