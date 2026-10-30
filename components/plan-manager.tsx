"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
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


// Owner-UI review P1 (2026-10-13) — price parsing is validated before
// any write. An invalid price is a visible field error, never a silent
// return or a coerced ₹0; a rejected price can never ride along as a
// "Saved." result. The server still validates the same rules
// (integer paise, at least 1 paise).
function parsePlanPrice(raw: string): { paise: number } | { error: string } {
  const paise = parseRupeesToPaise(raw);
  if (paise === null) {
    return { error: "Enter a price in rupees, like 2500 or 2500.50." };
  }
  if (paise <= 0n) {
    return { error: "Price must be more than ₹0." };
  }
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { error: "That price is too large." };
  }
  return { paise: Number(paise) };
}

type LocationOption = { id: string; name: string };
type ActivityOption = { id: string; name: string; locationId: string };

function kindLabel(plan: {
  kind: PlanKind;
  durationDays: number | null;
  sessions: number | null;
}): string {
  if (plan.kind === "duration" || plan.kind === "term")
    return `${plan.durationDays} days`;
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
    <div className="space-y-5">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Plans catalogue
      </h2>
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

      <h2 className="mt-2 font-display text-[16px] font-semibold text-ink">
        Add a plan
      </h2>
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
  const [priceError, setPriceError] = useState<string | null>(null);

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
              <Select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setActivityId("");
                }}
                
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Activity
              </span>
              <Select
                value={activityId}
                onChange={(e) => setActivityId(e.target.value)}
                
              >
                <option value="">All activities (all-access)</option>
                {facilityActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Template
              </span>
              <Select
                value={shapeId}
                onChange={(e) => setShapeId(e.target.value)}
                
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
              </Select>
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Price (₹, GST exclusive)
              </span>
              <Input
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceError(null);
                }}
                inputMode="decimal"
                placeholder="2500"
                aria-invalid={priceError !== null}
                
              />
              {priceError ? (
                <span role="alert" className="mt-1 block text-[12px] text-ink-2">
                  {priceError}
                </span>
              ) : null}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button
            variant="primary"
            size="md"
            className="inline-flex items-center justify-center"
            type="button"
              disabled={pending || alreadyActivated}
              onClick={() => {
                const parsed = parsePlanPrice(price);
                if ("error" in parsed) {
                  setPriceError(parsed.error);
                  return;
                }
                setPriceError(null);
                onSubmit({
                  shapeId,
                  locationId,
                  ...(activityId ? { activityId } : {}),
                  amountPaise: parsed.paise,
                });
              }}
          >
              {pending && pendingKey === "activate" ? "Saving…" : "Set price & activate"}
            </Button>
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
  const [priceError, setPriceError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

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
        <summary className="cursor-pointer text-[12px] text-[var(--accent-ink)] underline underline-offset-2">
          Edit
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Name
            </span>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              aria-invalid={nameError !== null}
              
            />
            {nameError ? (
              <span role="alert" className="mt-1 block text-[12px] text-ink-2">
                {nameError}
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Price (₹)
            </span>
            <Input
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceError(null);
              }}
              inputMode="decimal"
              aria-invalid={priceError !== null}
              
            />
            {priceError ? (
              <span role="alert" className="mt-1 block text-[12px] text-ink-2">
                {priceError}
              </span>
            ) : null}
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            className="inline-flex items-center justify-center"
            type="button"
            disabled={pending}
            onClick={() => {
              // Validate every field before writing anything: a bad
              // price must not be silently omitted while the name
              // saves and the UI reports success.
              const parsed = parsePlanPrice(price);
              if ("error" in parsed) {
                setPriceError(parsed.error);
                return;
              }
              if (name.trim().length === 0) {
                setNameError("Name can't be empty.");
                return;
              }
              setPriceError(null);
              setNameError(null);
              onSave({ name: name.trim(), amountPaise: parsed.paise });
            }}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {plan.isActive ? (
            <Button
          variant="secondary"
          size="md"
          className="inline-flex items-center justify-center border border-line text-ink-2 hover:text-ink"
              type="button"
              disabled={pending}
              onClick={onArchive}>
        Archive
      </Button>
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
  const [priceError, setPriceError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

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
          <Select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setActivityId("");
            }}
            
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Activity
          </span>
          <Select
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            
          >
            <option value="">All activities (all-access)</option>
            {facilityActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Name
          </span>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            aria-invalid={nameError !== null}
            
          />
          {nameError ? (
            <span role="alert" className="mt-1 block text-[12px] text-ink-2">
              {nameError}
            </span>
          ) : null}
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Kind
          </span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as PlanKind)}
            
          >
            <option value="duration">Duration (days)</option>
            <option value="term">Term (days)</option>
            <option value="sessions">Class pack</option>
            <option value="one_time">One-time</option>
            <option value="per_session">Pay-as-you-go (invoice)</option>
            <option value="drop_in">Drop-in (invoice)</option>
          </Select>
        </label>
        {kind === "duration" || kind === "term" ? (
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Days
            </span>
            <Input
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              inputMode="numeric"
              
            />
          </label>
        ) : null}
        {kind === "sessions" ? (
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Classes
            </span>
            <Input
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              inputMode="numeric"
              
            />
          </label>
        ) : null}
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Price (₹, GST exclusive)
          </span>
          <Input
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPriceError(null);
            }}
            inputMode="decimal"
            placeholder="2500"
            aria-invalid={priceError !== null}
            
          />
          {priceError ? (
            <span role="alert" className="mt-1 block text-[12px] text-ink-2">
              {priceError}
            </span>
          ) : null}
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button
            variant="primary"
            size="md"
            className="inline-flex items-center justify-center"
            type="button"
          disabled={pending || locations.length === 0}
          onClick={() => {
            const parsed = parsePlanPrice(price);
            if ("error" in parsed) {
              setPriceError(parsed.error);
              return;
            }
            if (name.trim().length === 0) {
              setNameError("Name can't be empty.");
              return;
            }
            setPriceError(null);
            setNameError(null);
            onSubmit({
              locationId,
              ...(activityId ? { activityId } : {}),
              name: name.trim(),
              kind,
              amountPaise: parsed.paise,
              ...(kind === "duration" || kind === "term"
                ? { durationDays: Number(durationDays) }
                : {}),
              ...(kind === "sessions" ? { sessions: Number(sessions) } : {}),
            });
          }}
          >
          {pending ? "Saving…" : "Add plan"}
        </Button>
        {message ? (
          <span role="status" className="text-[12px] text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
