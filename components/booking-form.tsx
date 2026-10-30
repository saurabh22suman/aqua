"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CafeMemberPicker } from "@/components/cafe-member-picker";
import { createBookingAction, quoteBookingAction } from "@/lib/actions/bookings";
import { Input } from "@/components/ui/Input";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import { SLOT_STARTS, slotEnd } from "@/components/booking-shared";
import { formatINR } from "@/lib/money/format";
import {
  formatDateIST,
  formatWallTime12h,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import type { BookableFacility } from "@/lib/services/bookings";
import type { MemberListRow } from "@/lib/services/people";
import type { TerminologyState } from "@/lib/terminology/keys";

// V-04 — the booking form half of the reception counter: facility →
// lane → date → hourly slot → member or walk-in → price (V-03) →
// create. The price shown is a server quote; create re-resolves it
// inside its own transaction, so a stale quote can never become a
// row. The create call never checks for a clash in the browser — the
// database's EXCLUDE constraint decides and the refusal is shown
// verbatim.

export function BookingForm({
  facilities,
  timezone,
  today,
  terminology,
  facilityId,
  onFacilityChange,
  date,
  onDateChange,
  onCreated,
  slotStart: slotStartProp,
  onSlotStartChange,
}: {
  facilities: BookableFacility[];
  timezone: string;
  today: string;
  terminology: TerminologyState;
  facilityId: string;
  onFacilityChange: (facilityId: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  onCreated: () => void;
  /**
   * Owner OpenPen (29 October 2026) — the slot board can choose a free
   * hour. The form keeps its own default when used alone, and follows
   * the board when the parent controls the value.
   */
  slotStart?: string;
  onSlotStartChange?: (slot: string) => void;
}) {
  const fieldId = useId();
  const [subUnitId, setSubUnitId] = useState("");
  const [internalSlotStart, setInternalSlotStart] = useState(SLOT_STARTS[9]!);
  const slotStart = slotStartProp ?? internalSlotStart;
  function chooseSlot(next: string) {
    if (slotStartProp === undefined) setInternalSlotStart(next);
    onSlotStartChange?.(next);
  }
  const [mode, setMode] = useState<"member" | "walk-in">("member");
  const [member, setMember] = useState<MemberListRow | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [quote, setQuote] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const facility = useMemo(
    () => facilities.find((candidate) => candidate.id === facilityId),
    [facilities, facilityId],
  );
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const dateInPast = dateValid && date < today;
  const dateError = !dateValid
    ? "Enter a valid date."
    : dateInPast
      ? "Choose today or a later date."
      : null;

  useEffect(() => {
    setSubUnitId("");
  }, [facilityId]);

  useEffect(() => {
    if (!facilityId) return;
    if (!dateValid || dateInPast) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const startsAt = zonedWallTimeToInstant(
          date,
          slotStart,
          timezone,
        ).toISOString();
        const result = await quoteBookingAction({ facilityId, startsAt });
        if (cancelled) return;
        setQuote(
          result.ok
            ? { ok: true, text: formatINR(result.pricePaise) }
            : { ok: false, text: result.error },
        );
      } catch {
        if (!cancelled) {
          setQuote({ ok: false, text: "Could not price that slot." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, date, dateValid, dateInPast, slotStart, timezone]);

  async function submit() {
    if (!facilityId || !dateValid || dateInPast) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const startsAt = zonedWallTimeToInstant(date, slotStart, timezone);
      const result = await createBookingAction({
        facilityId,
        subUnitId: subUnitId || null,
        memberId: mode === "member" ? (member?.memberId ?? null) : null,
        walkInName: mode === "walk-in" ? walkInName.trim() : null,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        mode === "walk-in"
          ? `Booked at ${formatINR(result.pricePaise)}. A walk-in is recorded, not payable in R1.`
          : `Booked at ${formatINR(result.pricePaise)}.`,
      );
      setMember(null);
      setWalkInName("");
      onCreated();
    } catch {
      setError("The booking could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4 space-y-4">
      <div
        className="rounded-ctl border border-line bg-deck/60 px-3 py-2.5"
        data-testid="booking-slot-summary"
      >
        <p className="text-[13px] font-medium leading-snug text-ink">
          {facility ? `${facility.name} · ` : ""}
          {dateValid && !dateInPast ? formatDateIST(date) : "Choose a valid date"}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
          {formatWallTime12h(slotStart)}–{formatWallTime12h(slotEnd(slotStart))} · 1 hour · {timezone}
          {facility?.locationName ? ` · ${facility.locationName}` : ""}
        </p>
      </div>
      <div>
        <label htmlFor={`${fieldId}-facility`} className="block text-[12px] font-medium text-ink-2 mb-1">
          {titleCase(resolveTerm(terminology, "facility", 1))}
        </label>
        <Select
          value={facilityId}
          onChange={(event) => onFacilityChange(event.target.value)}
          id={`${fieldId}-facility`}
          data-testid="booking-facility"
        >
          {facilities.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} · {option.locationName}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor={`${fieldId}-subunit`} className="block text-[12px] font-medium text-ink-2 mb-1">
            Lane / court
          </label>
          <Select
            value={subUnitId}
            onChange={(event) => setSubUnitId(event.target.value)}
            id={`${fieldId}-subunit`}
            data-testid="booking-subunit"
          >
            <option value="">
              {`Whole ${resolveTerm(terminology, "facility", 1)}`}
            </option>
            {(facility?.subUnits ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={`${fieldId}-date`} className="block text-[12px] font-medium text-ink-2 mb-1">
            Date
          </label>
          <DateField
            value={date}
            onChange={onDateChange}
            id={`${fieldId}-date`}
            data-testid="booking-date"
          />
          <p
            className={`mt-1 text-[11.5px] ${dateError ? "text-ink-2" : "text-ink-3"}`}
            role={dateError ? "alert" : undefined}
          >
            {dateError ?? `Today is ${formatDateIST(today)}.`}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={`${fieldId}-slot`} className="block text-[12px] font-medium text-ink-2 mb-1">
          Time slot
        </label>
        <Select
          value={slotStart}
          onChange={(event) => chooseSlot(event.target.value)}
          id={`${fieldId}-slot`}
          data-testid="booking-slot"
        >
          {SLOT_STARTS.map((start) => (
            <option key={start} value={start}>
              {formatWallTime12h(start)}–{formatWallTime12h(slotEnd(start))}
            </option>
          ))}
        </Select>
      </div>

      <fieldset>
        <legend className="block text-[12px] font-medium text-ink-2 mb-2">
          Who is it for?
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(["member", "walk-in"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`min-h-[44px] rounded-ctl border px-3 py-2 text-[13px] ${
                mode === option
                  ? "border-[var(--accent-strong)] bg-paper font-medium text-ink"
                  : "border-line bg-paper text-ink-2"
              }`}
              data-testid={`booking-mode-${option}`}
            >
              {option === "member" ? "Member" : "Walk-in"}
            </button>
          ))}
        </div>
      </fieldset>

      {mode === "member" ? (
        <CafeMemberPicker
          member={member}
          terminology={terminology}
          onSelect={setMember}
          disabled={busy}
        />
      ) : (
        <div>
          <label htmlFor={`${fieldId}-walkin-name`} className="block text-[12px] font-medium text-ink-2 mb-1">
            Walk-in name
          </label>
          <Input
            value={walkInName}
            onChange={(event) => setWalkInName(event.target.value)}
            placeholder="Name at the desk"
            id={`${fieldId}-walkin-name`}
            data-testid="booking-walkin-name"
          />
          <p className="mt-1.5 text-[11px] text-ink-3">
            A walk-in is recorded but not payable in R1 — billing needs a
            member.
          </p>
        </div>
      )}

      {quote ? (
        <p
          className={`text-[13px] ${
            quote.ok ? "text-ink-2" : "text-[color:var(--warn)]"
          }`}
          data-testid="booking-quote"
        >
          {quote.ok ? `Price ${quote.text}` : quote.text}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[13px] text-ink"
          data-testid="booking-error"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-ctl bg-good-soft px-3 py-2 text-[13px] text-ink">
          {notice}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={
          busy ||
          !dateValid ||
          dateInPast ||
          !quote?.ok ||
          (mode === "member"
            ? member === null
            : walkInName.trim().length === 0)
        }
        onClick={submit}
        data-testid="booking-create"
      >
        {busy ? "Booking…" : "Confirm booking"}
      </Button>
    </section>
  );
}
