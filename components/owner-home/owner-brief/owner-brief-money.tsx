import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRWhole } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { OwnerBriefCollections } from "@/components/owner-home/owner-brief/owner-brief-collections";
import type { OwnerBriefMoney } from "@/lib/services/owner-home-brief";
import type { NeedsReviewCashCount } from "@/lib/services/reconciliation-closed-state";

// Owner Home — one money block.
//
// Order is deliberate: an unresolved cash discrepancy keeps precedence, then
// payments recorded today is the clearest figure, the overdue decision comes
// before the subordinate reads, and the stated seven-day window sits beside
// the durable current balance. With no discrepancy, overdue takes the strong
// action. Recorded payments are every method the counter captured, never cash
// on hand and never revenue.

export function OwnerBriefMoneyBlock({
  money,
  cashReview,
  cashHref,
  overdueHref,
  feesHref,
  scopeLabel,
  todayIso,
  canReadFees,
}: {
  money: OwnerBriefMoney | null;
  cashReview: NeedsReviewCashCount | null;
  cashHref: string;
  overdueHref: string;
  feesHref: string;
  scopeLabel: string;
  todayIso: string;
  canReadFees: boolean;
}) {
  if (!canReadFees) return null;
  if (!money) {
    return (
      <section className="brief-ledger" aria-labelledby="brief-money-title" data-testid="owner-brief-money">
        <div className="brief-ledger-head">
          <h2 id="brief-money-title">Money</h2>
        </div>
        <p className="brief-normal">
          <OwnerIcon name="info" size={15} />
          Financial figures are unavailable.{" "}
          <Link href={feesHref}>Open Fees</Link>
        </p>
      </section>
    );
  }

  const hasOverdue = money.overdueInvoiceCount > 0;
  const todayCountLabel = `${money.todayCount} ${
    money.todayCount === 1 ? "payment" : "payments"
  } across all methods`;
  return (
    <>
      {cashReview ? <CashReview review={cashReview} href={cashHref} /> : null}
      <section className="brief-ledger" aria-labelledby="brief-money-title" data-testid="owner-brief-money">
        <div className="brief-ledger-head">
          <h2 id="brief-money-title">Money</h2>
          <OwnerBriefCollections
            days={money.days}
            periodLabel={money.periodLabel}
            scopeLabel={scopeLabel}
            todayIso={todayIso}
          />
        </div>
        <div className="brief-received">
          <div>
            <p className="brief-label">Payments recorded today</p>
            <p className="brief-major">{formatINRWhole(money.todayPaise)}</p>
            <p className="brief-today-note">
              {money.todayCount === 0
                ? "No payments recorded yet."
                : todayCountLabel}
            </p>
          </div>
        </div>
        {hasOverdue ? (
          <div className={`brief-overdue${cashReview ? " secondary" : ""}`}>
            <div className="brief-issue-face">
              <span className="brief-issue-icon" aria-hidden="true">
                <OwnerIcon name="alert" size={17} />
              </span>
              <div>
                <strong>{formatINRWhole(money.overduePaise)} overdue</strong>
                <p>
                  {money.overdueInvoiceCount}{" "}
                  {money.overdueInvoiceCount === 1 ? "invoice" : "invoices"}
                  {money.oldestOverdueDays !== null
                    ? ` · Oldest ${money.oldestOverdueDays} ${
                        money.oldestOverdueDays === 1 ? "day" : "days"
                      } late`
                    : ""}
                </p>
              </div>
            </div>
            <Link
              href={overdueHref}
              className={cashReview ? "brief-quiet" : "brief-primary"}
            >
              Review overdue invoices
              <OwnerIcon name="chevron" size={14} />
            </Link>
          </div>
        ) : (
          <p className="brief-normal">
            <OwnerIcon name="check" size={15} /> No overdue invoices
          </p>
        )}
        <div className="brief-balance">
          <div>
            <h3 className="brief-label">Recorded · Last 7 days</h3>
            {money.last7Paise === null ? (
              <span className="brief-secondary">Unavailable</span>
            ) : (
              <strong>{formatINRWhole(money.last7Paise)}</strong>
            )}
            <p className="brief-boundary">{money.periodLabel}</p>
          </div>
          <div className="brief-outstanding">
            <h3 className="brief-label">Outstanding · Current balance</h3>
            <strong>{formatINRWhole(money.outstandingPaise)}</strong>
          </div>
        </div>
      </section>
    </>
  );
}

function CashReview({
  review,
  href,
}: {
  review: NeedsReviewCashCount;
  href: string;
}) {
  const direction = review.variancePaise < 0 ? "short" : "over";
  return (
    <section className="brief-exception" aria-label="Cash count needs review">
      <div className="brief-issue-face">
        <span className="brief-issue-icon" aria-hidden="true">
          <OwnerIcon name="alert" size={17} />
        </span>
        <div>
          <strong>
            Cash count is {formatINRWhole(Math.abs(review.variancePaise))}{" "}
            {direction}
          </strong>
          <p>
            {review.locationName} · {formatDateIST(review.onDate)}
          </p>
        </div>
      </div>
      <Link className="brief-primary" href={href}>
        Review cash count <OwnerIcon name="chevron" size={14} />
      </Link>
    </section>
  );
}
