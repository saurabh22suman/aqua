"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CafeMemberPicker } from "@/components/cafe-member-picker";
import { createBookingAction, quoteBookingAction } from "@/lib/actions/bookings";
import { inputClass } from "@/components/cafe-order-shared";
import { SLOT_STARTS, slotEnd } from "@/components/booking-shared";
import { formatINR } from "@/lib/money/format";
import { zonedWallTimeToInstant } from "@/lib/time/tz";
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
}) {
  const [subUnitId, setSubUnitId] = useState("");
  const [slotStart, setSlotStart] = useState(SLOT_STARTS[9]!);
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

  useEffect(() => {
    setSubUnitId("");
  }, [facilityId]);

  useEffect(() => {
    if (!facilityId) return;
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
  }, [facilityId, date, slotStart, timezone]);

  async function submit() {
    if (!facilityId) return;
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
      <div>
        <label className="block text-[12px] font-medium text-ink-2 mb-1">
          {titleCase(resolveTerm(terminology, "facility", 1))}
        </label>
        <select
          value={facilityId}
          onChange={(event) => onFacilityChange(event.target.value)}
          className={inputClass}
          data-testid="booking-facility"
        >
          {facilities.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} · {option.locationName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-medium text-ink-2 mb-1">
            Lane / court
          </label>
          <select
            value={subUnitId}
            onChange={(event) => setSubUnitId(event.target.value)}
            className={inputClass}
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
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium text-ink-2 mb-1">
            Date
          </label>
          <input
            type="date"
            lang="en-IN"
            placeholder="dd/mm/yyyy"
            value={date}
            min={today}
            onChange={(event) => onDateChange(event.target.value)}
            className={inputClass}
            data-testid="booking-date"
          />
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-medium text-ink-2 mb-1">
          Time slot
        </label>
        <select
          value={slotStart}
          onChange={(event) => setSlotStart(event.target.value)}
          className={inputClass}
          data-testid="booking-slot"
        >
          {SLOT_STARTS.map((start) => (
            <option key={start} value={start}>
              {start}–{slotEnd(start)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="block text-[12px] font-medium text-ink-2 mb-2">
          Who is it for?
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["member", "walk-in"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`min-h-[44px] rounded-ctl border px-3 py-2 text-[13px] ${
                mode === option
                  ? "border-[var(--accent)] bg-paper font-medium text-ink"
                  : "border-line bg-paper text-ink-2"
              }`}
              data-testid={`booking-mode-${option}`}
            >
              {option === "member" ? "Member" : "Walk-in"}
            </button>
          ))}
        </div>
      </div>

      {mode === "member" ? (
        <CafeMemberPicker
          member={member}
          terminology={terminology}
          onSelect={setMember}
          disabled={busy}
        />
      ) : (
        <div>
          <label className="block text-[12px] font-medium text-ink-2 mb-1">
            Walk-in name
          </label>
          <input
            value={walkInName}
            onChange={(event) => setWalkInName(event.target.value)}
            className={inputClass}
            placeholder="Name at the desk"
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
          !quote?.ok ||
          (mode === "member"
            ? member === null
            : walkInName.trim().length === 0)
        }
        onClick={submit}
        data-testid="booking-create"
      >
        {busy ? "Booking…" : "Create booking"}
      </Button>
    </section>
  );
}
