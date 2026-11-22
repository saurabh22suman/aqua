"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { SectionHeading } from "@/components/ui/PageHeader";
import { setBookingPriceRuleActiveAction } from "@/lib/actions/booking-price-admin";
import { formatINRCompact } from "@/lib/money/format";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import {
  daySummary,
  windowSummary,
} from "@/components/bookings/booking-price-shared";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";

// Batch 6 — the configured-price list.
//
// Owner OpenPen (29 October 2026): the catalogue reads as aligned
// columns on desktop and as stacked identity-first rows on a phone.
// Deactivating is how a club retires a price without deleting the
// record of what it used to be; the server keeps the audit trail.

const DEFAULT_TERMINOLOGY: TerminologyState = { locale: "en", overrides: {} };

export function BookingPriceRuleList({
  rules,
  onEdit,
  terminology = DEFAULT_TERMINOLOGY,
}: {
  rules: BookingPriceRuleRow[];
  onEdit: (rule: BookingPriceRuleRow) => void;
  /** Resolved tenant vocabulary; defaults to English until the wrapper passes it. */
  terminology?: TerminologyState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleActive(rule: BookingPriceRuleRow) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await setBookingPriceRuleActiveAction({
        id: rule.id,
        isActive: !rule.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(rule.isActive ? "Price deactivated." : "Price activated.");
      // The catalogue is read on the server; re-read it so the row
      // shows the state that was actually saved.
      router.refresh();
    });
  }

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No prices configured yet"
        body="Until a price is configured, every slot refuses with “No price is configured for this slot”. Add one below and bookings can start."
      />
    );
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4">
      <SectionHeading
        title="Price catalogue"
        subtitle={
          rules.length === 1 ? "1 configured rule" : `${rules.length} configured rules`
        }
      />
      {error ? (
        <div className="mt-3" data-testid="price-rule-error">
          <InlineFeedback tone="error">{error}</InlineFeedback>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3" data-testid="price-rule-notice">
          <InlineFeedback tone="success">{notice}</InlineFeedback>
        </div>
      ) : null}

      <div className="mt-3 hidden border-b border-line pb-2 text-[11px] uppercase tracking-[0.08em] text-ink-3 md:grid md:grid-cols-4 md:items-center md:gap-3">
        <span>Rule</span>
        <span>{titleCase(resolveTerm(terminology, "facility", 1))}</span>
        <span>Applies</span>
        <span className="text-right">Price</span>
      </div>

      <ul className="divide-y divide-line" data-testid="price-rule-list">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="py-3 md:grid md:grid-cols-4 md:items-center md:gap-3"
            data-testid="price-rule-row"
          >
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink">{rule.label}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">
                {rule.isActive ? "Active" : "Inactive"} · priority{" "}
                {rule.priority}
              </p>
            </div>
            <p className="mt-0.5 min-w-0 text-[12px] text-ink-2 md:mt-0">
              {rule.facilityName ?? "All facilities"}
            </p>
            <p className="mt-0.5 min-w-0 text-[12px] text-ink-3 md:mt-0">
              {daySummary(rule.daysOfWeek)} ·{" "}
              {windowSummary(rule.startTime, rule.endTime)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 md:mt-0 md:justify-end">
              <p className="flex-none text-[14px] font-medium text-ink tabular-nums">
                {formatINRCompact(rule.pricePaise)}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEdit(rule)}
                data-testid="price-rule-edit"
              >
                Edit rule
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => toggleActive(rule)}
                data-testid="price-rule-toggle"
              >
                {rule.isActive ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
