import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRWhole } from "@/lib/money/format";
import { addDays, formatDateIST } from "@/lib/time/tz";
import { OwnerBriefCollections } from "@/components/owner-home/owner-brief/owner-brief-collections";
import type { OwnerBriefMoney } from "@/lib/services/owner-home-brief";
import type { NeedsReviewCashCount } from "@/lib/services/reconciliation-closed-state";

export function OwnerCollectionsMoney({
  money,
  cashReview,
  cashHref,
  overdueHref,
  feesHref,
  scopeLabel,
  todayIso,
  selectedDate,
  facilityId,
  canReadFees,
}: {
  money: OwnerBriefMoney | null;
  cashReview: NeedsReviewCashCount | null;
  cashHref: string;
  overdueHref: string;
  feesHref: string;
  scopeLabel: string;
  todayIso: string;
  selectedDate: string;
  facilityId: string | null;
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

  const day = money.days.find(entry => entry.key === selectedDate);
  const today = selectedDate === todayIso;
  const amount = today ? money.todayPaise : day?.paise;
  const paymentCount = today ? money.todayCount : day?.paymentCount;
  const max = Math.max(1, ...money.days.map(entry => entry.paise));
  const transactions = `/owner/fees?${new URLSearchParams({
    tab: "transactions", from: selectedDate, to: addDays(selectedDate, 1), facility: facilityId ?? "all",
  })}`;
  const dues = `/owner/fees?${new URLSearchParams({ tab: "dues", facility: facilityId ?? "all" })}`;

  return (
    <>
      {cashReview ? <CashReview review={cashReview} href={cashHref} /> : null}
      <section className="owner-collections-money" aria-label="Collections summary" data-testid="owner-brief-money">
        <div className="owner-collections-hero">
          <div className="owner-collections-hero-content">
            <div>
              <h2>{today ? "Collected today" : `Collected · ${formatDateIST(selectedDate)}`}</h2>
              <p className="brief-major">{amount === undefined ? "Unavailable" : formatINRWhole(amount)}</p>
              {paymentCount !== undefined ? <p>{paymentCount} {paymentCount === 1 ? "payment" : "payments"} recorded</p> : null}
            </div>
            {money.days.length ? (
              <div className="owner-collections-spark" role="img" aria-label={money.days.map(entry =>
                `${entry.fullLabel}: ${formatINRWhole(entry.paise)}${entry.key === selectedDate ? ", selected" : ""}`,
              ).join("; ")}>
                <div aria-hidden="true">
                  {money.days.map(entry => <span key={entry.key} data-selected={entry.key === selectedDate || undefined} style={{ height: `${(entry.paise / max) * 100}%` }} />)}
                </div>
                <small>Last 7 days</small>
              </div>
            ) : null}
          </div>
          <div className="owner-collections-hero-actions">
            <Link href={transactions} aria-label="View payments">View payments <OwnerIcon name="chevron" size={14} /></Link>
            <OwnerBriefCollections
              days={money.days}
              periodLabel={money.periodLabel}
              scopeLabel={scopeLabel}
              todayIso={selectedDate}
            />
          </div>
        </div>
        <div className="owner-collections-balances">
          <Link className="owner-collections-balance" href={dues}>
            <strong>Outstanding <OwnerIcon name="chevron" size={14} /></strong>
            <span className="owner-collections-balance-amount">{formatINRWhole(money.outstandingPaise)}</span>
            <small>Current balance</small>
          </Link>
          {money.overdueInvoiceCount > 0 ? (
            <Link className="owner-collections-balance is-overdue" href={overdueHref} aria-label="Review overdue invoices">
              <strong>Overdue <OwnerIcon name="chevron" size={14} /></strong>
              <span className="owner-collections-balance-amount">{formatINRWhole(money.overduePaise)}</span>
              <small>{money.overdueInvoiceCount} {money.overdueInvoiceCount === 1 ? "invoice" : "invoices"}</small>
            </Link>
          ) : (
            <div className="owner-collections-balance is-current">
              <strong>Overdue</strong>
              <span className="owner-collections-balance-amount">{formatINRWhole(0)}</span>
              <small>No overdue invoices</small>
            </div>
          )}
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
