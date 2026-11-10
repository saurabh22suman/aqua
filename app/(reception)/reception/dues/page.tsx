import { Phone } from "lucide-react";
import { requireReception } from "@/lib/auth/surface-guard";
import { listDeskDuesAction } from "@/lib/actions/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { STAFF_CARD, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

// M02 — the desk's read-only dues call list: issued/partial invoices
// with an outstanding balance for the caller's locations, overdue
// first. No totals, no mutations — the owner decides concessions.
//
// WR-1 / Option A — a walk-in bill with an outstanding balance is a due
// too, and it appears here: the desk must see the money the counter
// has not collected yet. A guest due has no member code and no phone,
// so there is nobody to call — the row says so instead of offering a
// call that cannot happen.
export default async function ReceptionDuesPage() {
  await requireReception();
  const dues = await listDeskDuesAction();

  return (
    <StaffPage className="max-w-xl">
      <BackLink href="/reception" label="Today" />
      <StaffPageHeader
        title="Dues"
        meta="Pending fee payments for your counter, overdue first. Call the family and record the payment when it comes in."
      />

      {dues.length === 0 ? (
        <div className={`mt-6 px-4 py-8 text-center ${STAFF_CARD}`}>
          <p className="text-[15px] font-medium text-ink">No dues right now</p>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Every invoice for your location is settled.
          </p>
        </div>
      ) : (
        <ul className={`mt-5 divide-y divide-line ${STAFF_CARD}`}>
          {dues.map((due) => (
            <li
              key={due.id}
              className="px-4 py-3"
              data-testid={`desk-due-${due.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-medium text-ink">
                    {due.payerName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {due.memberCode ?? "Walk-in"}
                    {due.phone ? (
                      <>
                        {" · "}
                        <a
                          href={`tel:${due.phone}`}
                          className="underline underline-offset-2"
                        >
                          {formatPhoneIN(due.phone)}
                        </a>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Invoice {due.invoiceNumber} · due {formatDateIST(due.dueOn)}
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p className="font-mono text-[14px] tabular-nums text-ink">
                    {formatINR(due.outstandingPaise)}
                  </p>
                  <div className="mt-1">
                    {due.overdue ? (
                      <StatusBadge tone="late">Overdue</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Open</StatusBadge>
                    )}
                  </div>
                  {/* The meta line's tel: anchor is 12px text; the
                      counter's actual tap target is this 44px Call
                      action (buttonClasses sm = the DESIGN floor). */}
                  {due.phone ? (
                    <a
                      href={`tel:${due.phone}`}
                      aria-label={`Call ${due.payerName}`}
                      className={buttonClasses({
                        variant: "secondary",
                        size: "sm",
                        className: "mt-2",
                      })}
                    >
                      <Phone size={14} strokeWidth={2} aria-hidden="true" />
                      Call
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </StaffPage>
  );
}
