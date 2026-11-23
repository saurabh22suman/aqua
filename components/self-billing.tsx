import type { readSelfBilling } from "@/lib/services/self-billing";
import { formatINR, formatINRCompact } from "@/lib/money/format";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { formatDateIST, formatDateTimeIST } from "@/lib/time/tz";
import Download from "lucide-react/dist/esm/icons/download.mjs";

type Billing = NonNullable<Awaited<ReturnType<typeof readSelfBilling>>>;

const METHODS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export function SelfBilling({ data, receiptBase, homeHref, childName, memberCode }: {
  data: Billing;
  receiptBase: string;
  homeHref: "/member" | "/family";
  childName?: string;
  memberCode?: string;
}) {
  const ownFees = homeHref === "/member";
  const [next, ...otherFees] = data.outstanding;
  const balance = data.outstanding.reduce((total, invoice) => total + BigInt(invoice.outstandingPaise), 0n);
  const formatMoney = ownFees ? formatINRCompact : formatINR;
  const invoiceLimitReached = data.outstanding.length === 10;

  return (
    <main className="self-page">
      <div className="self-main pb-8">
        <header className="min-w-0">
          <BackLink href={homeHref} label={homeHref === "/member" ? "Member home" : "Family home"} />
          <h1 className="text-2xl font-bold tracking-tight text-ink">Fees and payments</h1>
          {childName ? (
            <p className="mt-1 text-ink-2">For {childName}{memberCode ? ` · Member code ${memberCode}` : ""}</p>
          ) : null}
        </header>

        {ownFees && next ? (
          <section aria-labelledby="balance-title" className="min-w-0 rounded-card border border-line bg-paper p-4">
            <h2 id="balance-title" className="text-sm font-semibold text-ink-2">{invoiceLimitReached ? "Balance on invoices shown" : "Outstanding balance"}</h2>
            <p className="mt-1 text-[clamp(1.875rem,9vw,2.5rem)] font-bold leading-tight tabular-nums text-ink [overflow-wrap:anywhere]">{formatMoney(balance)}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-t border-line pt-1">
              <p className="text-[13px] text-ink-2">{data.outstanding.length} {data.outstanding.length === 1 ? "outstanding invoice" : "outstanding invoices"}</p>
              {data.payments.length > 0 ? <a href="#payments-title" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink underline underline-offset-2">Payments and receipts</a> : null}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="next-fee-title" className="min-w-0 rounded-card border border-line bg-paper p-4">
          <h2 id="next-fee-title" className="font-semibold">{next ? "Next fee due" : "Outstanding fees"}</h2>
          {next ? (
            <>
              <p className="mt-1 text-[clamp(1.5rem,6vw,2rem)] font-bold tabular-nums [overflow-wrap:anywhere]">{formatMoney(next.outstandingPaise)}</p>
              <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{next.invoiceNumber} · Due {formatDateIST(next.dueOn)}</p>
              {next.paidPaise > 0 ? <p className="mt-1 text-sm text-ink-2">{formatMoney(next.paidPaise)} already paid</p> : null}
            </>
          ) : <p className="mt-1 text-sm text-ink-2">No fees due.</p>}
        </section>

        {otherFees.length ? (
          <section aria-labelledby="other-fees-title" className="min-w-0 rounded-card border border-line bg-paper p-4">
            <h2 id="other-fees-title" className="font-semibold">Other outstanding fees</h2>
            <ul className="mt-2 divide-y divide-line">
              {otherFees.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
                  <span className="min-w-0 text-sm text-ink-2 [overflow-wrap:anywhere]">{invoice.invoiceNumber} · Due {formatDateIST(invoice.dueOn)}</span>
                  <span className="min-w-0 font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMoney(invoice.outstandingPaise)}</span>
                </li>
              ))}
            </ul>
            {invoiceLimitReached ? <p className="text-sm text-ink-2">Showing the 10 earliest outstanding invoices.</p> : null}
          </section>
        ) : null}

        <section aria-labelledby="payments-title" className="min-w-0 rounded-card border border-line bg-paper p-4">
          <h2 id="payments-title" tabIndex={ownFees ? -1 : undefined} className="scroll-mt-4 font-semibold">{ownFees ? "Recent payments and receipts" : "Recent payments"}</h2>
          {data.payments.length === 0 ? <p className="mt-1 text-sm text-ink-2">No payments recorded yet.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {data.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3">
                  <div className="min-w-0 flex-1 basis-32">
                    <p className="font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMoney(payment.amountPaise)} · {METHODS[payment.method] ?? payment.method}</p>
                    <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{formatDateTimeIST(payment.receivedAt)}{payment.invoiceNumber ? ` · ${payment.invoiceNumber}` : ""}</p>
                    {!payment.invoiceNumber ? <p className="mt-1 text-sm text-ink-2">No receipt for this payment.</p> : null}
                  </div>
                  {payment.invoiceNumber ? (
                    <form method="post" action={`${receiptBase}/${payment.id}`} className="shrink-0">
                      <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}
                        aria-label={`Download receipt for ${payment.invoiceNumber}, received ${formatDateTimeIST(payment.receivedAt)}`}
                      >
                        <Download size={15} aria-hidden="true" />
                        Receipt
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export function SelfBillingUnavailable({ homeHref, retryHref }: { homeHref: "/family" | "/member"; retryHref: string }) {
  return (
    <main className="self-page">
      <div className="self-main pb-8">
        <header>
          <BackLink href={homeHref} label={homeHref === "/family" ? "Family home" : "Member home"} />
          <h1 className="text-2xl font-bold">Fees and payments</h1>
        </header>
        <section className="rounded-card border border-line bg-paper p-4">
          <p role="alert" className="mb-3 text-sm text-ink">Could not load fees.</p>
          <a href={retryHref} aria-label="Retry fees" className={buttonClasses({ variant: "primary" })}>Retry</a>
        </section>
      </div>
    </main>
  );
}
