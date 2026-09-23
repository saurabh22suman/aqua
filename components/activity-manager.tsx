"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSubUnitAction,
  createActivityAction,
  deleteActivityAction,
  removeSubUnitAction,
  updateActivityAction,
} from "@/lib/actions/activities";
import type { ActivityRow } from "@/lib/services/activities";
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  type ActivityKind,
} from "@/lib/activities";

// Activity catalog manager (owner/admin). Activities are what the
// schema calls facilities — pool, court, table, café counter — under a
// location (the site). Plans attach to activities next.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

type LocationOption = { id: string; name: string; isPrimary?: boolean };

export function ActivityManager({
  locations,
  activities,
}: {
  locations: LocationOption[];
  activities: ActivityRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ActivityKind>("pool");
  const [capacity, setCapacity] = useState("10");
  const [subUnits, setSubUnits] = useState("");

  function run(key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setPendingKey(key);
    setMessages((prev) => ({ ...prev, [key]: "" }));
    startTransition(async () => {
      const result = await fn();
      setMessages((prev) => ({
        ...prev,
        [key]: result.ok ? "Saved." : result.error,
      }));
      if (result.ok) router.refresh();
      setPendingKey(null);
    });
  }

  const byLocation = new Map<string, ActivityRow[]>();
  for (const activity of activities) {
    const list = byLocation.get(activity.locationId) ?? [];
    list.push(activity);
    byLocation.set(activity.locationId, list);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-card bg-paper border border-line p-5 space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Add an activity
        </h2>
        {locations.length === 0 ? (
          <p className="text-[13px] text-ink-3">
            No facilities yet. A facility (site) is created at provisioning.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Facility
                </span>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={inputClass}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.isPrimary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Swimming pool"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Kind
                </span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ActivityKind)}
                  className={inputClass}
                >
                  {ACTIVITY_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {ACTIVITY_KIND_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Capacity
                </span>
                <input
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Sub-units (comma separated: lanes, tables)
                </span>
                <input
                  value={subUnits}
                  onChange={(e) => setSubUnits(e.target.value)}
                  placeholder="Lane 1, Lane 2, Lane 3"
                  className={inputClass}
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() =>
                  run("create", () =>
                    createActivityAction({
                      locationId,
                      name,
                      kind,
                      capacity: Number(capacity),
                      subUnits: subUnits
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }),
                  )
                }
                className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
              >
                {pending && pendingKey === "create" ? "Saving…" : "Add activity"}
              </button>
              {messages["create"] ? (
                <span role="status" className="text-[12px] text-ink-2">
                  {messages["create"]}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>

      {locations.map((location) => {
        const rows = byLocation.get(location.id) ?? [];
        return (
          <section key={location.id}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
              {location.name}
              {location.isPrimary ? " · primary" : ""}
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
                No activities at this facility yet.
              </p>
            ) : (
              <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
                {rows.map((activity) => (
                  <ActivityRowEditor
                    key={activity.id}
                    activity={activity}
                    pending={pending && pendingKey === activity.id}
                    message={messages[activity.id] ?? null}
                    onRun={(fn) => run(activity.id, fn)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ActivityRowEditor({
  activity,
  pending,
  message,
  onRun,
}: {
  activity: ActivityRow;
  pending: boolean;
  message: string | null;
  onRun: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => void;
}) {
  const [name, setName] = useState(activity.name);
  const [kind, setKind] = useState<ActivityKind>(activity.kind);
  const [capacity, setCapacity] = useState(String(activity.capacity));
  const [newSubUnit, setNewSubUnit] = useState("");

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">
          {activity.name}
          <span className="ml-2 text-[12px] text-ink-3">
            {ACTIVITY_KIND_LABELS[activity.kind]} · capacity {activity.capacity}
            {activity.isSample ? " · sample" : ""}
          </span>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Delete "${activity.name}"?`)) return;
            onRun(() => deleteActivityAction({ id: activity.id }));
          }}
          className="rounded-pill border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {activity.subUnits.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {activity.subUnits.map((unit) => (
            <span
              key={unit.id}
              className="inline-flex items-center gap-1 rounded-ctl bg-deck px-2 py-0.5 text-[11px] text-ink-2"
            >
              {unit.name}
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove ${unit.name}`}
                onClick={() => onRun(() => removeSubUnitAction({ id: unit.id }))}
                className="text-ink-3 hover:text-ink disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={newSubUnit}
          onChange={(e) => setNewSubUnit(e.target.value)}
          placeholder="Add sub-unit"
          className={`${inputClass} max-w-[12rem]`}
        />
        <button
          type="button"
          disabled={pending || !newSubUnit.trim()}
          onClick={() => {
            const value = newSubUnit.trim();
            setNewSubUnit("");
            onRun(() => addSubUnitAction({ activityId: activity.id, name: value }));
          }}
          className="rounded-pill border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-[var(--accent-ink)] underline underline-offset-2">
          Edit
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Kind
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ActivityKind)}
              className={inputClass}
            >
              {ACTIVITY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ACTIVITY_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Capacity
            </span>
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onRun(() =>
              updateActivityAction({
                id: activity.id,
                name,
                kind,
                capacity: Number(capacity),
              }),
            )
          }
          className="mt-3 rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </details>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
