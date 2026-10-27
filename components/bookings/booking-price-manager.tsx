"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookingPriceRuleForm } from "@/components/bookings/booking-price-rule-form";
import { BookingPriceRuleList } from "@/components/bookings/booking-price-rule-list";
import type { PriceFacilityOption } from "@/components/bookings/booking-price-shared";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";

// Batch 6 — the owner/admin editor for the booking price catalogue.
//
// This component owns only the editing state. The catalogue itself is
// read on the server (lib/actions/booking-price-admin.ts) and comes
// back with the page, so the list a visitor sees is never a client's
// stale copy.

export function BookingPriceManager({
  facilities,
  rules,
}: {
  facilities: PriceFacilityOption[];
  rules: BookingPriceRuleRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BookingPriceRuleRow | null>(null);

  function refresh() {
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <BookingPriceRuleForm
        key={editing?.id ?? "new"}
        facilities={facilities}
        editingRule={editing}
        onSaved={refresh}
        onCancel={() => setEditing(null)}
      />
      <BookingPriceRuleList rules={rules} onEdit={setEditing} />
    </div>
  );
}
