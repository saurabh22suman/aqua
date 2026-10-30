"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { BookingPriceRuleForm } from "@/components/bookings/booking-price-rule-form";
import { BookingPriceRuleList } from "@/components/bookings/booking-price-rule-list";
import type { PriceFacilityOption } from "@/components/bookings/booking-price-shared";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";
import type { TerminologyState } from "@/lib/terminology/keys";

// Batch 6 — the owner/admin editor for the booking price catalogue.
//
// Owner OpenPen (29 October 2026): the configured catalogue leads; one
// bounded editor is revealed for Add or Edit. An empty catalogue opens
// the editor directly because there is nothing to list yet.
//
// This component owns only the editing state. The catalogue itself is
// read on the server (lib/actions/booking-price-admin.ts) and comes
// back with the page, so the list a visitor sees is never a client's
// stale copy.

export function BookingPriceManager({
  facilities,
  rules,
  terminology,
}: {
  facilities: PriceFacilityOption[];
  rules: BookingPriceRuleRow[];
  /** Resolved tenant vocabulary supplied by the management-owned page. */
  terminology?: TerminologyState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BookingPriceRuleRow | null>(null);
  const [formOpen, setFormOpen] = useState(rules.length === 0);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    setEditing(null);
    setFormOpen(false);
    setNotice("Price saved.");
    router.refresh();
  }

  function closeEditor() {
    setEditing(null);
    setFormOpen(false);
    setNotice(null);
  }

  return (
    <div className="space-y-5">
      {!formOpen ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setNotice(null);
              setFormOpen(true);
            }}
            data-testid="booking-price-add"
          >
            Add price rule
          </Button>
        </div>
      ) : null}

      {notice ? (
        <div data-testid="booking-price-saved">
          <InlineFeedback tone="success">{notice}</InlineFeedback>
        </div>
      ) : null}

      <BookingPriceRuleList
        rules={rules}
        terminology={terminology}
        onEdit={(rule) => {
          setNotice(null);
          setEditing(rule);
          setFormOpen(true);
        }}
      />

      {formOpen ? (
        <BookingPriceRuleForm
          key={editing?.id ?? "new"}
          facilities={facilities}
          editingRule={editing}
          onSaved={refresh}
          onCancel={closeEditor}
        />
      ) : null}

      <section className="rounded-card border border-line bg-paper p-4">
        <p className="text-[12.5px] text-ink-2">
          An unpriced slot is refused; existing bookings retain their quoted
          price.
        </p>
        <Link
          href="/owner/bookings"
          className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Open booking desk
        </Link>
      </section>
    </div>
  );
}
