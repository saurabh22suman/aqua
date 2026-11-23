import { Suspense } from "react";
import { OwnerStageScope } from "@/components/owner-home/owner-facility-scope";
import { OwnerBriefMoneyBlock } from "@/components/owner-home/owner-brief/owner-brief-money";
import { OwnerBriefToday } from "@/components/owner-home/owner-brief/owner-brief-today";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import type { NeedsAttentionItem } from "@/lib/services/dashboard";
import type { OwnerBriefView } from "@/lib/services/owner-home-brief";

export function ManagementBrief({
  brief,
  sport,
  attention,
}: {
  brief: OwnerBriefView;
  sport: "pool" | "court";
  attention: readonly NeedsAttentionItem[];
}) {
  const registers = brief.can.schedule
    ? attention.filter(item => item.title === "Register not started")
    : [];

  return (
    <div className="brief-home" data-brief-sport={sport}>
      <div className="management-scope">
        <Suspense fallback={<span role="status">Loading facilities…</span>}>
          <OwnerStageScope />
        </Suspense>
      </div>
      <header className="brief-mast">
        <div>
          <p>{brief.tenantShortName} · <time dateTime={brief.todayIso}>{brief.dateLabel}</time></p>
          <h1>Club operations</h1>
        </div>
      </header>
      <div className="brief-body">
        <div className="brief-today-column">
          {registers.length > 0 ? (
            <section className="brief-block" aria-labelledby="register-attention">
              <div className="brief-block-title"><h2 id="register-attention">Registers to check</h2></div>
              {registers.map((item, index) => (
                <div key={item.href ?? index} className="brief-row">
                  <span className="brief-row-icon"><OwnerIcon name="calendar" size={16} /></span>
                  <span className="brief-row-copy">
                    <strong>{item.title}</strong>
                    <span className="brief-secondary">{item.detail}</span>
                  </span>
                  {item.href ? <OwnerLink href={item.href} className="brief-quiet">Review</OwnerLink> : null}
                </div>
              ))}
            </section>
          ) : null}
          <OwnerBriefToday
            session={brief.session}
            followUps={brief.followUps}
            scheduleHref={brief.scheduleHref}
            canSchedule={brief.can.schedule}
            canEnquiries={brief.can.enquiries}
          />
        </div>
        <div className="brief-money-column">
          <OwnerBriefMoneyBlock
            money={brief.money}
            cashReview={brief.cashReview}
            cashHref={brief.cashHref}
            overdueHref={brief.overdueHref}
            feesHref={brief.feesHref}
            scopeLabel={brief.scopeLabel}
            todayIso={brief.todayIso}
            canReadFees={brief.can.fees}
          />
        </div>
      </div>
    </div>
  );
}
