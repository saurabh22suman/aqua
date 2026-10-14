import { Phone } from "lucide-react";
import { requireReception } from "@/lib/auth/surface-guard";
import { listDeskDuesAction } from "@/lib/actions/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";

// M02 — the desk's read-only dues call list: issued/partial invoices
// with an outstanding balance for the caller's locations, overdue
// first. No totals, no mutations — the owner decides concessions.

export default async function ReceptionDuesPage() {
  await requireReception();
  const dues = await listDeskDuesAction();

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <BackLink href="/reception" label="Today" />
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Dues
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Pending fee payments for your counter, overdue first. Call the family
        and record the payment when it comes in.
      </p>

      {dues.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-paper px-4 py-8 text-center">
          <p className="text-[15px] font-medium text-ink">No dues right now</p>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Every invoice for your location is settled.
          </p>
        </div>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-card border border-line bg-paper divide-y divide-line">
          {dues.map((due) => (
            <li
              key={due.id}
              className="px-4 py-3"
              data-testid={`desk-due-${due.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {due.memberName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {due.memberCode}
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
                  <p className="font-mono text-[14px] text-ink">
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
                      aria-label={`Call ${due.memberName}`}
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
    </main>
  );
}
