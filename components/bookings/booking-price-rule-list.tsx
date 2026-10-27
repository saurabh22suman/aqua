"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { setBookingPriceRuleActiveAction } from "@/lib/actions/booking-price-admin";
import { formatINRCompact } from "@/lib/money/format";
import {
  daySummary,
  windowSummary,
} from "@/components/bookings/booking-price-shared";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";

// Batch 6 — the configured-price list.
//
// Deactivating is how a club retires a price without deleting the
// record of what it used to be; the server keeps the audit trail.

export function BookingPriceRuleList({
  rules,
  onEdit,
}: {
  rules: BookingPriceRuleRow[];
  onEdit: (rule: BookingPriceRuleRow) => void;
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
        body="Until a price is configured, every slot refuses with “No price is configured for this slot”. Add one above and bookings can start."
      />
    );
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold text-ink">
        Configured prices
      </h2>
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
      <ul className="mt-3 divide-y divide-line" data-testid="price-rule-list">
        {rules.map((rule) => (
          <li key={rule.id} className="py-3" data-testid="price-rule-row">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">{rule.label}</p>
                <p className="text-[12px] text-ink-3">
                  {rule.facilityName ?? "All facilities"} ·{" "}
                  {daySummary(rule.daysOfWeek)} ·{" "}
                  {windowSummary(rule.startTime, rule.endTime)}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {rule.isActive ? "Active" : "Inactive"} · priority{" "}
                  {rule.priority}
                </p>
              </div>
              <p className="flex-none text-[14px] font-medium text-ink tabular-nums">
                {formatINRCompact(rule.pricePaise)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEdit(rule)}
                data-testid="price-rule-edit"
              >
                Edit
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
