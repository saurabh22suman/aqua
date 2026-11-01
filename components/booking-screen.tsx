"use client";

import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BookingForm } from "@/components/booking-form";
import { BookingDayList, BookingRowActions } from "@/components/booking-day-list";
import {
  cancelBookingAction,
  requestBookingBillAction,
} from "@/lib/actions/bookings";
import type { PaymentMethod } from "@/components/cafe-order-shared";
import type { BookableFacility, BookingDayRow } from "@/lib/services/bookings";
import type { BookingBill } from "@/lib/services/booking-billing";
import type { TerminologyState } from "@/lib/terminology/keys";
import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { OwnerCalendarToolbar } from "@/components/owner-calendar/owner-calendar-toolbar";
import { calendarRange } from "@/components/owner-calendar/calendar-layout";
import { Tabs } from "@/components/ui/Tabs";
import { SectionHeading } from "@/components/ui/PageHeader";
import {
  BOOKING_CATEGORY_LABELS,
  SLOT_STARTS,
  bookingToCalendarEvent,
} from "@/components/booking-shared";
import {
  BookingReadError,
  useBookingDayRead,
  useBookingWeekRead,
} from "@/components/booking-reads";
import { addDays, formatDateIST } from "@/lib/time/tz";

// THE BILL AND THE RECEIPT ARE LOADED ON DEMAND.
//
// The desk screen's first load carries the bill panel and the receipt,
// and both are drawn only once a bill exists — a bill is raised by the
// counter, long after the screen is on. Carrying them in the screen's
// own load pushed `/owner/bookings` past the product's first-load
// budget (DESIGN.md §5), so the two are now loaded the way the product
// already loads the leave request form and a member's invoice rows:
// when they are first needed.
//
// Nothing about the flow changes. The amount is still shown, the
// payment is still collected by hand, and the receipt is still shown
// afterwards; only the moment the code arrives moves.
const BookingBillPanel = dynamic(
  () =>
    import("@/components/booking-bill-panel").then(
      (module) => module.BookingBillPanel,
    ),
  {
    loading: () => (
      <p role="status" className="text-[13px] text-ink-3">
        Loading bill…
      </p>
    ),
  },
);
const BookingReceipt = dynamic(
  () =>
    import("@/components/booking-bill-panel").then(
      (module) => module.BookingReceipt,
    ),
  {
    loading: () => (
      <p role="status" className="text-[13px] text-ink-3">
        Loading receipt…
      </p>
    ),
  },
);

// V-04 — the booking counter: the create form, the day board and the
// bill/collect split. Once a bill is open the screen becomes the bill
// (Request bill → amount visible → Collect → receipt).
//
// Owner redesign (27 October 2026): the day board has a calendar
// beside it, on a time ruler, so a clash at 18:00 is visible before it
// is a problem. The detail panel carries the SAME bill and cancel
// actions the list carries, and the list is never taken away.
//
// The desk reads a DAY at a time through the existing authorised
// action, so the week view is seven of those reads for the same
// facility — no new backend, no new permission. The read state lives
// in components/booking-reads.tsx: a failed read says so and offers a
// retry, and it never reads as an empty day.
//
// SCOPE HONESTY: the rows on screen always belong to the date and
// facility in the heading.

export function BookingScreen({
  facilities,
  timezone,
  today,
  terminology,
}: {
  facilities: BookableFacility[];
  timezone: string;
  today: string;
  terminology: TerminologyState;
}) {
  const [requestedFacilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const facilityId = facilities.some((facility) => facility.id === requestedFacilityId)
    ? requestedFacilityId
    : facilities[0]?.id ?? "";
  const [date, setDate] = useState(today);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bill, setBill] = useState<BookingBill | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>("cash");
  // The bill currently on screen. A payment that resolves late for a
  // different bill must not mark this one paid.
  const currentBillId = useRef<string | null>(null);

  useEffect(() => {
    currentBillId.current = bill?.invoiceId ?? null;
  }, [bill?.invoiceId]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "board">("calendar");
  const [scope, setScope] = useState<"day" | "week" | "agenda">("day");
  // Owner OpenPen (29 October 2026) — the board and the selected slot
  // share one chosen hour, so "Choose slot" is the same decision as
  // the form's time slot.
  const [slotStart, setSlotStart] = useState(SLOT_STARTS[9]!);
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const selectedFacility = useMemo(
    () => facilities.find((candidate) => candidate.id === facilityId),
    [facilities, facilityId],
  );

  // The week the chosen day belongs to. Monday-first, the same order
  // the schedule's week column reads.
  const week = useMemo(
    () => (hasDate ? calendarRange(date, "week").days : []),
    [date, hasDate],
  );

  // The reads follow what is on show: the board and the day view read
  // the chosen day, the week view reads the week. Nothing is read
  // behind a surface the owner is not looking at.
  const showWeek = (scope === "week" || scope === "agenda") && view === "calendar";
  const showDay = scope === "day" || view === "board";
  const dayRead = useBookingDayRead(
    date,
    facilityId,
    refreshKey,
    showDay && hasDate,
  );
  const weekRead = useBookingWeekRead(
    week,
    date,
    facilityId,
    refreshKey,
    showWeek && hasDate,
  );

  async function cancel(row: BookingDayRow) {
    setBusyId(row.bookingId);
    setError(null);
    try {
      const result = await cancelBookingAction({ bookingId: row.bookingId });
      if (!result.ok) setError(result.error);
      else setRefreshKey((key) => key + 1);
    } catch {
      setError("The booking could not be cancelled. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function requestBill(row: BookingDayRow) {
    setBusyId(row.bookingId);
    setError(null);
    try {
      const result = await requestBookingBillAction({
        bookingId: row.bookingId,
      });
      if (!result.ok) setError(result.error);
      else setBill(result.bill);
    } catch {
      setError("The bill could not be raised. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  function resetBill() {
    setBill(null);
    setPaid(false);
    setRefreshKey((key) => key + 1);
  }

  if (bill && paid) {
    return <BookingReceipt bill={bill} method={paidMethod} onReset={resetBill} />;
  }
  if (bill) {
    return (
      <div className="space-y-4">
        {error ? <ErrorNote message={error} /> : null}
        <BookingBillPanel
          bill={bill}
          onPaid={(method, billId) => {
            if (billId && billId !== currentBillId.current) {
              setError(
                "A payment for another bill was recorded. Check that bill before collecting again.",
              );
              return;
            }
            setPaidMethod(method);
            setPaid(true);
          }}
          onBack={resetBill}
        />
      </div>
    );
  }

  // The agenda lists the WEEK, so it reads and shows the week; the day
  // scope shows the day. The scope decides both, so they cannot
  // disagree.
  const calendarRead = showWeek ? weekRead : dayRead;
  const calendarRows = calendarRead.rows;
  const calendarDays = showWeek ? week : [date];
  const calendarEvents = calendarRows.map(bookingToCalendarEvent);
  const rowById = new Map(calendarRows.map((row) => [row.bookingId, row]));
  const step = showWeek ? 7 : 1;

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Owner OpenPen (29 October 2026) — the slot board and the
          selected slot sit side by side on desktop; on a phone the
          board comes first and the selected slot follows. The board
          keeps every existing calendar/board control; the form keeps
          the server quote and the customer identity together. */}
      <section
        // self-start keeps the board at its intrinsic height: as a grid
        // item it stretched to the taller selected-slot column.
        className="order-1 min-w-0 self-start rounded-card border border-line bg-paper p-4 sm:p-5 lg:col-span-3"
        data-testid="booking-board"
      >
        <div>
          <div className="min-w-0">
            <SectionHeading
              title="Day board"
              subtitle={
                selectedFacility
                  ? `${selectedFacility.name} · ${selectedFacility.locationName}`
                  : "Choose a facility and date to read the day."
              }
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
          <Tabs
            label="Booking view"
            value={view}
            onValueChange={(value) =>
              setView(value === "board" ? "board" : "calendar")
            }
            tabs={[
              { value: "calendar", label: "Calendar" },
              { value: "board", label: "Board" },
            ]}
          />
          <a href="#new-booking" className="inline-flex min-h-11 items-center rounded-ctl border border-line px-3 text-[13px] font-medium text-[var(--accent-ink)]">New booking</a>
          </div>
        </div>
        {error ? <ErrorNote message={error} /> : null}

        {!hasDate ? (
          <p
            role="alert"
            className="mt-4 rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-2"
          >
            Choose a valid date in the selected slot to read the board.
          </p>
        ) : view === "calendar" ? (
          <>
            {/* Two control groups: the range tabs and the shared
                navigation row keep a token gap between them. */}
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Tabs
                  label="Calendar range"
                  value={scope}
                  onValueChange={(value) =>
                    setScope(
                      value === "week"
                        ? "week"
                        : value === "agenda"
                          ? "agenda"
                          : "day",
                    )
                  }
                  tabs={[
                    { value: "day", label: "Day" },
                    { value: "week", label: "Week" },
                    { value: "agenda", label: "Agenda" },
                  ]}
                />
              </div>
              <OwnerCalendarToolbar
                navigation={{
                  previous: { onSelect: () => setDate(addDays(date, -step)) },
                  today: { onSelect: () => setDate(today) },
                  next: { onSelect: () => setDate(addDays(date, step)) },
                }}
                rangeLabel={
                  showWeek
                    ? `${formatDateIST(week[0]!)} – ${formatDateIST(week[6]!)}`
                    : formatDateIST(date)
                }
                timezone={timezone}
                labels={{
                  previous: (
                    <>
                      <ChevronLeft className="sm:hidden" size={18} aria-hidden="true" />
                      <span className="hidden sm:inline">
                        {showWeek ? "Previous week" : "Previous day"}
                      </span>
                    </>
                  ),
                  today: "Today",
                  next: (
                    <>
                      <ChevronRight className="sm:hidden" size={18} aria-hidden="true" />
                      <span className="hidden sm:inline">
                        {showWeek ? "Next week" : "Next day"}
                      </span>
                    </>
                  ),
                }}
                ariaLabels={{
                  previous: showWeek ? "Previous week" : "Previous day",
                  today: "Today",
                  next: showWeek ? "Next week" : "Next day",
                }}
              />
            </div>
            {calendarRead.failed ? (
              <BookingReadError
                message={calendarRead.error}
                onRetry={calendarRead.retry}
              />
            ) : calendarRead.loading ? (
              <p
                className="mt-4 rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3"
                data-testid="booking-loading"
              >
                Loading the {scope}…
              </p>
            ) : (
              <OwnerCalendar
                events={calendarEvents}
                days={calendarDays}
                view={showWeek ? (scope === "agenda" ? "agenda" : "week") : "day"}
                selectedDate={date}
                todayDate={today}
                onSelectDay={(day) => setDate(day)}
                labels={BOOKING_CATEGORY_LABELS}
                empty={{
                  title: showWeek
                    ? "No bookings in this week"
                    : "No bookings on this day",
                  body: "Pick a facility, date and slot beside the board to put the first one on it.",
                }}
                renderEventActions={(event) => {
                  const row = rowById.get(event.id);
                  if (!row || row.status === "cancelled") return null;
                  return (
                    <BookingRowActions
                      row={row}
                      busyId={busyId}
                      onCancel={cancel}
                      onBill={requestBill}
                    />
                  );
                }}
              />
            )}
          </>
        ) : (
          <div className="mt-3">
            {dayRead.failed ? (
              <BookingReadError
                message={dayRead.error}
                onRetry={dayRead.retry}
              />
            ) : dayRead.loading ? (
              <p
                className="rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3"
                data-testid="booking-loading"
              >
                Loading the day…
              </p>
            ) : (
              <BookingDayList
                rows={dayRead.rows}
                busyId={busyId}
                onCancel={cancel}
                onBill={requestBill}
                slots={SLOT_STARTS}
                onChooseSlot={setSlotStart}
              />
            )}
          </div>
        )}
      </section>

      <section id="new-booking" className="order-2 min-w-0 scroll-mt-[calc(var(--app-sticky-offset,0px)+5rem)] lg:col-span-2" data-testid="booking-selected-slot">
        <SectionHeading
          title="New booking"
          subtitle="Confirm the selected slot and quoted price."
        />
        <div className="mt-3">
          <BookingForm
            facilities={facilities}
            timezone={timezone}
            today={today}
            terminology={terminology}
            facilityId={facilityId}
            onFacilityChange={setFacilityId}
            date={date}
            onDateChange={setDate}
            onCreated={() => setRefreshKey((key) => key + 1)}
            slotStart={slotStart}
            onSlotStartChange={setSlotStart}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * A message beside the thing it is about — a refusal the server made,
 * or a failure the desk could not recover from on its own.
 */
function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[13px] text-ink"
      data-testid="booking-error"
    >
      {message}
    </p>
  );
}
