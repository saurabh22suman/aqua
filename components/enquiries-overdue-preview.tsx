"use client";

import { useState } from "react";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { OverdueFollowUp } from "@/lib/services/enquiries";
import { formatDateIST } from "@/lib/time/tz";

export function EnquiriesOverduePreview({ followUps, detailHrefPrefix, onShowQueue }: {
  followUps: OverdueFollowUp[];
  detailHrefPrefix: string;
  onShowQueue?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (followUps.length === 0) return null;
  const sorted = [...followUps].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return (
    <section className="min-w-0 rounded-card border border-line bg-paper p-[18px] sm:p-5">
      <div className="flex min-w-0 items-start gap-3 rounded-ctl bg-[var(--accent-soft)] px-3 py-2">
        <CalendarClock size={19} aria-hidden="true" className="mt-1 shrink-0 text-[var(--accent-ink)]" />
        <div className="min-w-0">
          <h2 className="font-display text-[18px] font-semibold text-ink">Overdue follow-ups</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge tone="late">{sorted.length} overdue</StatusBadge>
          </div>
        </div>
      </div>
      <ul className="min-w-0 divide-y divide-line">
        {(expanded ? sorted : sorted.slice(0, 3)).map((followUp) => (
          <li key={followUp.id} className="min-w-0 py-1">
            <Link href={`${detailHrefPrefix}/${followUp.enquiryId}`} aria-label={`Follow up ${followUp.enquiryName}`} className="flex min-h-11 w-full min-w-0 items-center gap-2 py-2 text-[13px] text-ink">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block font-medium">{followUp.enquiryName}</span>
                <span className="block text-ink-2">Due {formatDateIST(followUp.dueAt)}</span>
                {followUp.note ? <span className="block text-ink-2">{followUp.note}</span> : null}
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--accent-ink)]" />
            </Link>
          </li>
        ))}
      </ul>
      {onShowQueue || sorted.length > 3 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {onShowQueue ? <Button variant="secondary" size="sm" aria-label="Show follow-up queue" onClick={onShowQueue}>Queue</Button> : null}
          {sorted.length > 3 ? <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : "Show all"}</Button> : null}
        </div>
      ) : null}
    </section>
  );
}
