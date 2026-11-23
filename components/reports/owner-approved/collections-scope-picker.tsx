"use client";

import { useId, useState } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { addDays, formatDateIST, formatFullDateIST } from "@/lib/time/tz";

type Scope = { onDate: string; locationId: string };

export function CollectionsScopePicker({
  scope,
  today,
  locations,
  facilityLabel,
  disabled,
  hasCashDraft,
  onApply,
}: {
  scope: Scope;
  today: string;
  locations: { id: string; name: string }[];
  facilityLabel: string;
  disabled: boolean;
  hasCashDraft: boolean;
  onApply: (scope: Scope) => void;
}) {
  const [draft, setDraft] = useState<Scope | null>(null);
  const formId = useId();
  const locationName = locations.find(location => location.id === scope.locationId)?.name
    ?? `Choose a ${facilityLabel}`;
  const dateLabel = formatDateIST(scope.onDate);

  return (
    <>
      <button type="button" className="owner-period-pill w-full max-w-sm disabled:opacity-60"
        aria-label={`Collection date and facility, ${dateLabel}, ${locationName}`}
        aria-haspopup="dialog" aria-expanded={draft !== null} disabled={disabled}
        onClick={() => setDraft(scope)}>
        <OwnerIcon name="calendar" size={17} />
        <span className="min-w-0 flex-1 break-words">
          <time dateTime={scope.onDate}>{dateLabel}</time>
          <span className="px-1.5" aria-hidden="true">·</span>
          {locationName}
        </span>
        <OwnerIcon name="down" size={13} />
      </button>
      <Dialog open={draft !== null} onOpenChange={open => { if (!open) setDraft(null); }}
        title="Collection date and facility"
        description={hasCashDraft ? "Applying a different date or facility clears the unsaved cash count for this view." : undefined}
        swipeToClose
        footer={<>
          <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
          <Button type="submit" form={formId} disabled={!draft?.locationId || !draft?.onDate}>Apply</Button>
        </>}>
        {draft ? (
          <form id={formId} className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (!draft.onDate || !locations.some(location => location.id === draft.locationId)) return;
            onApply(draft);
            setDraft(null);
          }}>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Last 7 days</legend>
              <div className="grid grid-cols-4 gap-1 min-[370px]:grid-cols-7">
                {Array.from({ length: 7 }, (_, index) => {
                  const day = addDays(today, index - 6);
                  const label = formatFullDateIST(day);
                  const selected = day === draft.onDate;
                  return (
                    <button key={day} type="button" aria-label={label}
                      aria-pressed={selected} aria-current={day === today ? "date" : undefined}
                      onClick={() => setDraft({ ...draft, onDate: day })}
                      className={`grid min-h-11 min-w-11 place-content-center rounded-ctl border text-center text-xs ${selected ? "border-[var(--accent-strong)] bg-[var(--selected-surface)] text-[var(--selected-ink)]" : "border-line bg-paper text-ink-2"}`}>
                      <span>{label.split(",")[0]}</span>
                      <strong className="tabular-nums">{Number(day.slice(8))}</strong>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field id={`${formId}-date`} label="Date" required>
              {field => <DateField {...field} value={draft.onDate}
                onChange={onDate => setDraft({ ...draft, onDate })} />}
            </Field>
            <Field id={`${formId}-facility`} label={facilityLabel}>
              {field => <Select {...field} value={draft.locationId}
                onChange={event => setDraft({ ...draft, locationId: event.target.value })}>
                {!draft.locationId ? <option value="">Choose a {facilityLabel}</option> : null}
                {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </Select>}
            </Field>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
