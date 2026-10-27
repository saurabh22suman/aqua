"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { saveBookingPriceRuleAction } from "@/lib/actions/booking-price-admin";
import {
  PRICE_DAY_CHOICES,
  daySummary,
  paiseToRupees,
  type PriceFacilityOption,
} from "@/components/bookings/booking-price-shared";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";

// Batch 6 — the add/edit form for one booking price rule.
//
// The rule this screen must not invent: WHICH rule wins. The resolver
// (lib/services/booking-pricing.ts) owns that — priority, then
// facility-specific, then the narrowest window, then the narrower day
// set — so this form lets two rules overlap and says so plainly.
//
// Money crosses the wire as the rupees the owner typed; the server
// converts them to exact integer paise. This screen never computes
// money.

export function BookingPriceRuleForm({
  facilities,
  editingRule,
  onSaved,
  onCancel,
}: {
  facilities: PriceFacilityOption[];
  editingRule: BookingPriceRuleRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(editingRule?.label ?? "");
  const [facilityId, setFacilityId] = useState(editingRule?.facilityId ?? "");
  const [priceRupees, setPriceRupees] = useState(
    editingRule ? paiseToRupees(editingRule.pricePaise) : "",
  );
  const [days, setDays] = useState<number[]>(editingRule?.daysOfWeek ?? []);
  const [startTime, setStartTime] = useState(editingRule?.startTime ?? "");
  const [endTime, setEndTime] = useState(editingRule?.endTime ?? "");
  const [priority, setPriority] = useState(
    editingRule ? String(editingRule.priority) : "0",
  );
  const [isActive, setIsActive] = useState(editingRule?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day)
        ? prev.filter((value) => value !== day)
        : [...prev, day],
    );
  }

  async function save() {
    setError(null);
    setNotice(null);
    const result = await saveBookingPriceRuleAction({
      id: editingRule?.id ?? null,
      label,
      facilityId: facilityId === "" ? null : facilityId,
      daysOfWeek: days,
      startTime: startTime === "" ? null : startTime,
      endTime: endTime === "" ? null : endTime,
      priceRupees,
      priority: Number(priority || "0"),
      isActive,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Clear the values so the next rule starts from a blank sheet. The
    // facility stays: a club usually prices one facility at a time.
    setLabel("");
    setPriceRupees("");
    setDays([]);
    setStartTime("");
    setEndTime("");
    setPriority("0");
    setNotice("Price saved.");
    onSaved();
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4 space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-ink">
          {editingRule ? "Change a price" : "Add a price"}
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          A rule prices a slot when its day and time match. Leave the days
          and the times empty and it prices every slot. Where two rules
          match, the more specific one wins — the higher priority, then the
          one for a named facility, then the narrower time window.
        </p>
      </div>

      <Field id="price-label" label="Name">
        {(field) => (
          <Input
            {...field}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Evening rate"
            maxLength={80}
            data-testid="price-rule-label"
          />
        )}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id="price-facility" label="Facility">
          {(field) => (
            <Select
              {...field}
              value={facilityId}
              onChange={(event) => setFacilityId(event.target.value)}
              data-testid="price-rule-facility"
            >
              <option value="">All facilities</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name} · {facility.locationName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="price-amount"
          label="Price"
          description="Rupees per booking. Paise are kept exactly — 500.50 is ₹500.50."
        >
          {(field) => (
            <Input
              {...field}
              value={priceRupees}
              onChange={(event) =>
                setPriceRupees(event.target.value.replace(/[^\d.,]/g, ""))
              }
              placeholder="500"
              inputMode="decimal"
              data-testid="price-rule-price"
            />
          )}
        </Field>
      </div>

      <div>
        <p className="text-[12px] font-medium text-ink-2 mb-2">Days</p>
        <div className="flex flex-wrap gap-2">
          {PRICE_DAY_CHOICES.map((day) => {
            const on = days.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day.value)}
                className={`min-h-11 rounded-ctl border px-3 py-2 text-[13px] ${
                  on
                    ? "border-[var(--accent-strong)] bg-paper font-medium text-ink"
                    : "border-line bg-paper text-ink-2"
                }`}
                data-testid={`price-rule-day-${day.value}`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          {days.length === 0 ? "Every day." : `Only ${daySummary(days)}.`}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field id="price-start" label="From">
          {(field) => (
            <Input
              {...field}
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              data-testid="price-rule-start"
            />
          )}
        </Field>
        <Field id="price-end" label="To">
          {(field) => (
            <Input
              {...field}
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              data-testid="price-rule-end"
            />
          )}
        </Field>
        <Field
          id="price-priority"
          label="Priority"
          description="Higher wins."
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              data-testid="price-rule-priority"
            />
          )}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="h-4 w-4"
          data-testid="price-rule-active"
        />
        Active — an inactive rule keeps its place but stops pricing slots.
      </label>

      {error ? (
        <div data-testid="price-rule-error">
          <InlineFeedback tone="error">{error}</InlineFeedback>
        </div>
      ) : null}
      {notice ? (
        <div data-testid="price-rule-notice">
          <InlineFeedback tone="success">{notice}</InlineFeedback>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() => startTransition(() => void save())}
          data-testid="price-rule-save"
        >
          {pending ? "Saving…" : editingRule ? "Save changes" : "Save price"}
        </Button>
        {editingRule ? (
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setError(null);
              setNotice(null);
              onCancel();
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}
