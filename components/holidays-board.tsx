"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Trash2 } from "lucide-react";
import { addHolidayAction, removeHolidayAction } from "@/lib/actions/holidays";
import type { HolidayRow } from "@/lib/services/holidays";
import { formatDateIST } from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";
import { DateField } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

// R.3 (docs/five-day-work-guide.md) — owner holiday/closure editor.
// The session generator already skips these dates; this is the surface
// that lets an owner declare them.
//
// P1 (2026-10-13 owner-UI review) — the board used to freeze the
// initial prop, so a refresh after add/remove could not change the
// list. It now adopts the server's refreshed collection whenever the
// server re-renders, after every successful mutation (and after a
// failure the draft inputs are kept for retry).
export function HolidaysBoard({
  initialHolidays,
}: {
  initialHolidays: HolidayRow[];
}) {
  const router = useRouter();
  const [holidays, setHolidays] = useState(initialHolidays);
  const [name, setName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [recurringYearly, setRecurringYearly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<HolidayRow | null>(null);
  // MD-01 follow-up — the removal refusal must be visible in the active
  // confirmation, not inside the separate (possibly closed) add editor.
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    // The server component re-renders after router.refresh(); adopting
    // the fresh prop is what makes a successful add/remove visible
    // without a manual browser reload, and stops a removed row from
    // being resurrected by local state.
    setHolidays(initialHolidays);
  }, [initialHolidays]);

  async function submit() {
    if (!name.trim() || !holidayDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addHolidayAction({
        name: name.trim(),
        holidayDate,
        recurringYearly,
      });
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      setName("");
      setHolidayDate("");
      setRecurringYearly(false);
      router.refresh();
    } catch {
      setError(
        "The holiday was not saved. Check the date and retry — your entry is kept below.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(holidayId: string): Promise<boolean> {
    setBusy(true);
    setRemoveError(null);
    try {
      // A structured result proves its own outcome. A THROWN result proves
      // neither success nor failure: the server may have committed the
      // removal before the response was lost.
      let res: Awaited<ReturnType<typeof removeHolidayAction>>;
      try {
        res = await removeHolidayAction({ holidayId });
      } catch {
        setRemoveError(
          "The result could not be confirmed — the holiday may or may not have been removed. Refresh the list before retrying, so a removal is not applied twice.",
        );
        return false;
      }
      if (res.kind === "error") {
        setRemoveError(res.message);
        return false;
      }

      // Confirmed removal: reflect the committed row locally. The refresh
      // is a re-render, not part of the removal, so its failure must not
      // rewrite this outcome.
      setHolidays((current) =>
        current.filter((holiday) => holiday.id !== holidayId),
      );
      try {
        router.refresh();
      } catch {
        // Keep the confirmed local state.
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Holiday list
      </h2>
      <p className="max-w-[65ch] text-[12.5px] text-ink-3">
        Session generation skips these dates. This does not cancel sessions
        already generated.
      </p>
      {holidays.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper">
          <EmptyState
            title="No holidays yet"
            body="Declare a holiday and the session generator skips it — no empty register at the pool."
          />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-paper">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="h-9 w-9 rounded-[11px] bg-deck text-ink-3 grid place-items-center flex-none">
                <CalendarOff size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{h.name}</p>
                <p className="text-[11.5px] text-ink-3">
                  {formatDateIST(h.holidayDate)}
                  {h.recurringYearly ? " · Repeats yearly" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRemoveError(null);
                  setPendingRemove(h);
                }}
                disabled={busy}
                aria-label={`Remove ${h.name}`}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-ctl text-ink-3 disabled:opacity-50"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-card border border-line bg-paper p-5">
        <summary className="flex min-h-11 cursor-pointer items-center font-display text-[16px] font-semibold text-ink">
          Add holiday
        </summary>
        <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">
            Holiday name
          </span>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Founder's Day"
            className="w-full border text-[16px]"
            data-testid="holiday-name"
          />
        </label>
        <Field id="holiday-date" label="Date" required>
          {(field) => (
            <DateField
              {...field}
              value={holidayDate}
              onChange={setHolidayDate}
              tone="deck"
              data-testid="holiday-date"
            />
          )}
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={recurringYearly}
            onChange={(e) => setRecurringYearly(e.target.checked)}
            className="h-4 w-4"
          />
          Repeats every year on this date
        </label>
        <Button
          variant="primary"
          size="md"
          className="w-full"
          type="button"
          onClick={submit}
          disabled={busy || !name.trim() || !holidayDate}>
        Add holiday
      </Button>
        {error ? (
          <p role="alert" className="text-[12px] text-ink-2">
            {error}
          </p>
        ) : null}
        </div>
      </details>

      <Dialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemove(null);
            setRemoveError(null);
          }
        }}
        title="Remove this holiday?"
        description={
          pendingRemove
            ? `${pendingRemove.name} · ${formatDateIST(pendingRemove.holidayDate)}. Removing this holiday allows future session generation for this date. Existing sessions are unchanged.`
            : undefined
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPendingRemove(null);
                setRemoveError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!pendingRemove) return;
                void (async () => {
                  const removed = await remove(pendingRemove.id);
                  if (removed) setPendingRemove(null);
                })();
              }}
            >
              {busy ? "Removing…" : "Confirm removal"}
            </Button>
          </>
        }
      >
        {removeError ? (
          <p role="alert" className="text-[13px] text-ink-2">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
