"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activatePlanFromShapeAction,
  archivePlanAction,
  createPlanAction,
  updatePlanAction,
} from "@/lib/actions/membership-plans";
import type {
  PlanKind,
  PlanMutationResult,
  PlanRow,
  PlanTemplateRow,
} from "@/lib/services/membership-plans";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";

// C-29c — plans are priced per facility, optionally per activity
// (all-access when none is chosen). Prices are GST-exclusive; the GST
// rate is configured per facility/activity in the ops console.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none";

type LocationOption = { id: string; name: string };
type ActivityOption = { id: string; name: string; locationId: string };

function kindLabel(plan: {
  kind: PlanKind;
  durationDays: number | null;
  sessions: number | null;
}): string {
  if (plan.kind === "duration") return `${plan.durationDays} days`;
  if (plan.kind === "sessions") return `${plan.sessions} classes`;
  return "one-time";
}

export function PlanManager({
  templates,
  plans,
  locations,
  activities,
}: {
  templates: PlanTemplateRow[];
  plans: PlanRow[];
  locations: LocationOption[];
  activities: ActivityOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  function run(key: string, fn: () => Promise<PlanMutationResult>) {
    setPendingKey(key);
    setMessages((prev) => ({ ...prev, [key]: "" }));
    startTransition(async () => {
      const result = await fn();
      setMessages((prev) => ({ ...prev, [key]: result.ok ? "Saved." : result.error }));
      if (result.ok) router.refresh();
      setPendingKey(null);
    });
  }

  const byLocation = new Map<string, PlanRow[]>();
  for (const plan of plans) {
    const list = byLocation.get(plan.locationId) ?? [];
    list.push(plan);
    byLocation.set(plan.locationId, list);
  }

  return (
    <div className="space-y-8">
      <ActivateTemplateForm
        templates={templates}
        plans={plans}
        locations={locations}
        activities={activities}
        pending={pending}
        pendingKey={pendingKey}
        message={messages.activate ?? null}
        onSubmit={(input) => run("activate", () => activatePlanFromShapeAction(input))}
      />

      {locations.map((location) => {
        const rows = byLocation.get(location.id) ?? [];
        return (
          <section key={location.id}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
              {location.name}
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
                No plans at this facility yet.
              </p>
            ) : (
              <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
                {rows.map((plan) => (
                  <PlanRowEditor
                    key={plan.id}
                    plan={plan}
                    pending={pending && pendingKey === plan.id}
                    message={messages[plan.id] ?? null}
                    onSave={(patch) =>
                      run(plan.id, () => updatePlanAction({ id: plan.id, ...patch }))
                    }
                    onArchive={() => run(plan.id, () => archivePlanAction({ id: plan.id }))}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <CustomPlanForm
        locations={locations}
        activities={activities}
        pending={pending}
        message={messages.custom ?? null}
        onSubmit={(input) => run("custom", () => createPlanAction(input))}
      />
    </div>
  );
}

function ActivateTemplateForm({
  templates,
  plans,
  locations,
  activities,
  pending,
  pendingKey,
  message,
  onSubmit,
}: {
  templates: PlanTemplateRow[];
  plans: PlanRow[];
  locations: LocationOption[];
  activities: ActivityOption[];
  pending: boolean;
  pendingKey: string | null;
  message: string | null;
  onSubmit: (input: {
    shapeId: string;
    locationId: string;
    activityId?: string;
    amountPaise: number;
  }) => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [activityId, setActivityId] = useState("");
  const [shapeId, setShapeId] = useState(templates[0]?.shapeId ?? "");
  const [price, setPrice] = useState("");

  const facilityActivities = activities.filter(
    (activity) => activity.locationId === locationId,
  );
  const alreadyActivated = plans.some(
    (plan) =>
      plan.sourceShapeId === shapeId &&
      plan.locationId === locationId &&
      (plan.activityId ?? "") === activityId,
  );

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-3">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Activate a preset template
      </h2>
      <p className="text-[12px] text-ink-3">
        Pick the facility (and optionally one activity — leave it as
        all-access for a combo plan), then price the template.
      </p>
      {templates.length === 0 || locations.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          A preset template and a facility are needed first.
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
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setActivityId("");
                }}
                className={inputClass}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Activity
              </span>
              <select
                value={activityId}
                onChange={(e) => setActivityId(e.target.value)}
                className={inputClass}
              >
                <option value="">All activities (all-access)</option>
                {facilityActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Template
              </span>
              <select
                value={shapeId}
                onChange={(e) => setShapeId(e.target.value)}
                className={inputClass}
              >
                {templates.map((template) => (
                  <option key={template.shapeId} value={template.shapeId}>
                    {template.name} ·{" "}
                    {kindLabel({
                      kind: template.kind,
                      durationDays: template.durationDays,
                      sessions: template.sessions,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Price (₹, GST exclusive)
              </span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="2500"
                className={inputClass}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending || alreadyActivated}
              onClick={() => {
                const amountPaise = parseRupeesToPaise(price);
                if (amountPaise === null) return;
                onSubmit({
                  shapeId,
                  locationId,
                  ...(activityId ? { activityId } : {}),
                  amountPaise: Number(amountPaise),
                });
              }}
              className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
            >
              {pending && pendingKey === "activate" ? "Saving…" : "Set price & activate"}
            </button>
            {alreadyActivated ? (
              <span className="text-[12px] text-ink-3">
                Already activated here — edit the plan below.
              </span>
            ) : null}
            {message ? (
              <span role="status" className="text-[12px] text-ink-2">
                {message}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function PlanRowEditor({
  plan,
  pending,
  message,
  onSave,
  onArchive,
}: {
  plan: PlanRow;
  pending: boolean;
  message: string | null;
  onSave: (patch: { name?: string; amountPaise?: number }) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(
    formatINR(plan.amountPaise).replace(/[₹,]/g, ""),
  );

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">
          {plan.name}{" "}
          <span className="text-[12px] text-ink-3">
            · {plan.activityName ?? "all activities"} · {kindLabel(plan)} ·{" "}
            {formatINR(plan.amountPaise)}
          </span>
        </span>
        {!plan.isActive ? (
          <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
            Archived
          </span>
        ) : null}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-[var(--accent)] underline underline-offset-2">
          Edit
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Name
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Price (₹)
            </span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const paise = parseRupeesToPaise(price);
              onSave({
                name,
                ...(paise !== null ? { amountPaise: Number(paise) } : {}),
              });
            }}
            className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {plan.isActive ? (
            <button
              type="button"
              disabled={pending}
              onClick={onArchive}
              className="rounded-pill border border-line px-4 py-2 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
            >
              Archive
            </button>
          ) : null}
        </div>
      </details>
      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function CustomPlanForm({
  locations,
  activities,
  pending,
  message,
  onSubmit,
}: {
  locations: LocationOption[];
  activities: ActivityOption[];
  pending: boolean;
  message: string | null;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [activityId, setActivityId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlanKind>("duration");
  const [durationDays, setDurationDays] = useState("30");
  const [sessions, setSessions] = useState("1");
  const [price, setPrice] = useState("");

  const facilityActivities = activities.filter(
    (activity) => activity.locationId === locationId,
  );

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-3">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Add a custom plan
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Facility
          </span>
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setActivityId("");
            }}
            className={inputClass}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Activity
          </span>
          <select
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            className={inputClass}
          >
            <option value="">All activities (all-access)</option>
            {facilityActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Name
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Kind
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PlanKind)}
            className={inputClass}
          >
            <option value="duration">Duration (days)</option>
            <option value="sessions">Class pack</option>
            <option value="one_time">One-time</option>
          </select>
        </label>
        {kind === "duration" ? (
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Days
            </span>
            <input
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
        ) : null}
        {kind === "sessions" ? (
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Classes
            </span>
            <input
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Price (₹, GST exclusive)
          </span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="2500"
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || locations.length === 0}
          onClick={() => {
            const amountPaise = parseRupeesToPaise(price);
            onSubmit({
              locationId,
              ...(activityId ? { activityId } : {}),
              name,
              kind,
              amountPaise: amountPaise === null ? 0 : Number(amountPaise),
              ...(kind === "duration" ? { durationDays: Number(durationDays) } : {}),
              ...(kind === "sessions" ? { sessions: Number(sessions) } : {}),
            });
          }}
          className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add plan"}
        </button>
        {message ? (
          <span role="status" className="text-[12px] text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
