import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerMoneySummary } from "@/lib/services/dashboard";

// Owner Today — the two figures inside the photographic stage.
//
// Floodlit states today's captured payments and the outstanding balance
// as two stage metrics, with overdue as a SUBSET line under them (it is
// the part of the balance that is late, never a third total). Each
// figure keeps its real, scoped destination; the rupee mark is drawn in
// the body face while the amount uses the display face (see
// app/(owner)/floodlit-owner.css).
export function OwnerHomeFinancialSnapshot({
  money,
  paymentsHref,
  invoicesHref,
  overdueHref,
}: {
  money: OwnerMoneySummary | null;
  paymentsHref: string;
  invoicesHref: string;
  overdueHref: string | null;
}) {
  return (
    <section
      aria-labelledby="owner-financial-snapshot"
      data-testid="owner-home-lead"
      className={`floodlit-financial${money ? "" : " floodlit-financial-unavailable"}`}
    >
      <h2 id="owner-financial-snapshot" className="sr-only">
        Financial snapshot
      </h2>
      {money ? (
        <>
          <Metric
            label="Payments recorded today"
            paise={money.collectedTodayPaise}
            href={paymentsHref}
            linkText={`${money.collectedTodayCount} recorded ${
              money.collectedTodayCount === 1 ? "payment" : "payments"
            }`}
          />
          <Metric
            label="Outstanding now"
            paise={money.outstandingPaise}
            href={invoicesHref}
            linkText={`${money.dueInvoiceCount} open ${
              money.dueInvoiceCount === 1 ? "invoice" : "invoices"
            }`}
          />
          <div className="floodlit-overdue">
            <p className="floodlit-overdue-line overdue-line">
              <OwnerIcon name="alert" size={14} />
              Of which <strong>{formatINRCompact(money.overduePaise)} overdue</strong>
            </p>
            {overdueHref && money.overdueInvoiceCount > 0 ? (
              <OwnerLink href={overdueHref} className="floodlit-overdue-link text-btn">
                Review overdue <OwnerIcon name="chevron" size={14} />
              </OwnerLink>
            ) : null}
          </div>
        </>
      ) : (
        <p className="floodlit-unavailable">
          Financial figures are unavailable.{" "}
          <OwnerLink href={invoicesHref}>Open Fees</OwnerLink>
        </p>
      )}
    </section>
  );
}

/** One stage metric: label, amount, and the figure's real destination. */
function Metric({
  label,
  paise,
  href,
  linkText,
}: {
  label: string;
  paise: number;
  href: string;
  linkText: string;
}) {
  const amount = formatINRCompact(paise);
  return (
    <div className="floodlit-metric metric">
      <p className="floodlit-metric-label metric-title" data-testid="owner-floodlit-metric-label">
        {label}
      </p>
      <p
        className="floodlit-metric-value metric-value"
        data-testid="owner-floodlit-metric-value"
        data-wide-amount={amount.length > 8 || undefined}
      >
        <span className="rupee">₹</span>{amount.slice(1)}
      </p>
      <OwnerLink href={href} className="floodlit-metric-link metric-btn">
        {linkText} <OwnerIcon name="chevron" size={14} />
      </OwnerLink>
    </div>
  );
}
