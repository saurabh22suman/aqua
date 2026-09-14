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
// Strict rupee → paise parsing (same helper the collect screen uses).
import { parseRupeesToPaise } from "@/lib/payment-qr";

// C-29 — plan management: activate priced plans from preset templates,
// create custom plans, edit prices, archive.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none";

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
}: {
  templates: PlanTemplateRow[];
  plans: PlanRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});

  function run(key: string, fn: () => Promise<PlanMutationResult>) {
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

  function priceToPaise(key: string): number | null {
    const parsed = parseRupeesToPaise(prices[key] ?? "");
    return parsed === null ? null : Number(parsed);
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Preset templates
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          Seeded by the applied preset, unpriced. Enter a price to turn a
          template into a sellable plan.
        </p>
        {templates.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
            No templates. Apply a preset to seed them, or add a custom plan
            below.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {templates.map((template) => (
              <div
                key={template.shapeId}
                className="border-b border-line last:border-b-0 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-medium text-ink">
                    {template.name}{" "}
                    <span className="text-[12px] text-ink-3">
                      · {kindLabel({ kind: template.kind, durationDays: template.durationDays, sessions: template.sessions })}
                    </span>
                  </span>
                  {template.activatedPlanId ? (
                    <span className="rounded-pill bg-marine/10 px-2 py-0.5 text-[11px] text-marine">
                      Active ·{" "}
                      {formatINR(template.activatedAmountPaise ?? 0)}
                    </span>
                  ) : null}
                </div>
                {template.activatedPlanId ? null : (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block grow min-w-[10rem]">
                      <span className="block text-[12px] font-medium text-ink-2 mb-1">
                        Price (₹)
                      </span>
                      <input
                        value={prices[template.shapeId] ?? ""}
                        onChange={(e) =>
                          setPrices((prev) => ({
                            ...prev,
                            [template.shapeId]: e.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="2500"
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        pending && pendingKey === template.shapeId
                      }
                      onClick={() => {
                        const amountPaise = priceToPaise(template.shapeId);
                        if (amountPaise === null) {
                          setMessages((prev) => ({
                            ...prev,
                            [template.shapeId]: "Enter a price like 2500 or 2500.50.",
                          }));
                          return;
                        }
                        run(template.shapeId, () =>
                          activatePlanFromShapeAction({
                            shapeId: template.shapeId,
                            amountPaise,
                          }),
                        );
                      }}
                      className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
                    >
                      {pending && pendingKey === template.shapeId
                        ? "Saving…"
                        : "Set price & activate"}
                    </button>
                    {messages[template.shapeId] ? (
                      <span role="status" className="text-[12px] text-ink-2">
                        {messages[template.shapeId]}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Your plans
        </h2>
        {plans.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
            No plans yet.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {plans.map((plan) => (
              <PlanRowEditor
                key={plan.id}
                plan={plan}
                pending={pending && pendingKey === plan.id}
                message={messages[plan.id] ?? null}
                onSave={(patch) =>
                  run(plan.id, () => updatePlanAction({ id: plan.id, ...patch }))
                }
                onArchive={() =>
                  run(plan.id, () => archivePlanAction({ id: plan.id }))
                }
              />
            ))}
          </div>
        )}
      </section>

      <CustomPlanForm
        pending={pending}
        message={messages["custom"] ?? null}
        onSubmit={(input) => run("custom", () => createPlanAction(input))}
      />
    </div>
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
  onSave: (patch: { name?: string; amountPaise?: number; isActive?: boolean }) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(plan.name);
  // Populate the editable field from formatINR (the one sanctioned
  // paise→display conversion) — never a local /100.
  const [price, setPrice] = useState(
    formatINR(plan.amountPaise).replace(/[₹,]/g, ""),
  );

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">
          {plan.name}{" "}
          <span className="text-[12px] text-ink-3">
            · {kindLabel(plan)} · {formatINR(plan.amountPaise)}
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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
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
  pending,
  message,
  onSubmit,
}: {
  pending: boolean;
  message: string | null;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlanKind>("duration");
  const [durationDays, setDurationDays] = useState("30");
  const [sessions, setSessions] = useState("1");
  const [price, setPrice] = useState("");

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-3">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Add a custom plan
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              Sessions
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
            Price (₹)
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
          disabled={pending}
          onClick={() => {
            const amountPaise = parseRupeesToPaise(price);
            onSubmit({
              name,
              kind,
              amountPaise: amountPaise === null ? 0 : Number(amountPaise),
              ...(kind === "duration"
                ? { durationDays: Number(durationDays) }
                : {}),
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
