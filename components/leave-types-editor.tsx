"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import {
  createLeaveTypeAction,
  updateLeaveTypeAction,
} from "@/lib/actions/leave";
import type { LeaveTypeRow } from "@/lib/services/leave";

// V-26 — owner's leave-type editor: the three seeded defaults plus
// whatever the academy adds. Quota blank means unlimited; `paid`
// decides whether V-30 deducts the days from pay.

export function LeaveTypesEditor({ types }: { types: LeaveTypeRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("");
  const [isPaid, setIsPaid] = useState(true);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : (result.error ?? "Something went wrong."));
      if (result.ok) router.refresh();
    });
  }

  function quotaValue(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return (
    <section className="mt-6 rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold">Leave types</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Quota is days per calendar year; leave it blank for unlimited.
      </p>

      <ul className="mt-3 divide-y divide-line">
        {types.map((type) => (
          <li key={type.id} className="py-3">
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]">
                <span className="font-medium">{type.name}</span>
                <span className="text-[12.5px] text-ink-3">
                  {type.annualQuota === null
                    ? "unlimited"
                    : `${type.annualQuota} days/year`}
                  {" · "}
                  {type.isPaid ? "paid" : "unpaid"}
                </span>
              </summary>
              <form
                className="mt-3 grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  run(() =>
                    updateLeaveTypeAction({
                      id: type.id,
                      name: String(form.get("name") ?? "").trim(),
                      annualQuota: quotaValue(String(form.get("quota") ?? "")),
                      isPaid: form.get("paid") === "on",
                    }),
                  );
                }}
              >
                <div>
                  <Field id={`leave-type-${type.id}-name`} label="Name">
                    {(field) => (
                      <Input
                        {...field}
                        name="name"
                        defaultValue={type.name}
                      />
                    )}
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <Field id={`leave-type-${type.id}-quota`} label="Days per year">
                      {(field) => (
                        <Input
                          {...field}
                          name="quota"
                          inputMode="numeric"
                          defaultValue={type.annualQuota ?? ""}
                          placeholder="Unlimited"
                        />
                      )}
                    </Field>
                  </div>
                  <label className="flex min-h-11 items-center gap-2 self-end text-[13px]">
                    <input
                      type="checkbox"
                      name="paid"
                      defaultChecked={type.isPaid}
                      className="h-5 w-5"
                    />
                    Paid leave
                  </label>
                </div>
                <Button type="submit" variant="secondary" disabled={pending}>
                  Save changes
                </Button>
              </form>
            </details>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 grid gap-3 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(() =>
            createLeaveTypeAction({
              name: name.trim(),
              annualQuota: quotaValue(quota),
              isPaid,
            }),
          );
          setName("");
          setQuota("");
          setIsPaid(true);
        }}
      >
        <div>
          <Field id="leave-type-new-name" label="New leave type">
            {(field) => (
              <Input
                {...field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Comp off"
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <Field id="leave-type-new-quota" label="Days per year">
              {(field) => (
                <Input
                  {...field}
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                  inputMode="numeric"
                  placeholder="Unlimited"
                />
              )}
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2 self-end text-[13px]">
            <input
              type="checkbox"
              checked={isPaid}
              onChange={(e) => setIsPaid(e.target.checked)}
              className="h-5 w-5"
            />
            Paid leave
          </label>
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || name.trim().length === 0}
        >
          Add leave type
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </section>
  );
}
