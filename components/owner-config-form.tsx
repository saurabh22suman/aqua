"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  requestConfigChangeAction,
  setOwnerConfigValueAction,
} from "@/lib/actions/owner-config";
import {
  KEY_TITLES,
  fromInputValue,
  isStructured,
  readOnlyValue,
  scopeLabel,
  toInputValue,
  valueType,
  type OwnerConfigItem,
} from "@/components/settings/owner-config-values";

// O-07 — the registry-rendered owner settings form. Editable keys get
// an inline control; read-only keys show the current value greyed with
// a Request change disclosure. Values are rendered from the key's
// jsonSchema, never hardcoded per key.
//
// P1 (2026-10-13 owner-UI review) — structured values are never
// stringified into a text box (`[object Object]`), technical UUID
// scope ids are not primary labels, and known keys get human titles.
// `operations.business_hours` is edited at location scope in the
// Locations workspace, so this page summarises it and links there
// instead of pretending a tenant-level text field can edit it.
// Display helpers live in components/settings/owner-config-values.ts.


export function OwnerConfigForm({ items }: { items: OwnerConfigItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items
        .filter((item) => !isStructured(item))
        .map((item) => [item.key, toInputValue(item.value)]),
    ),
  );
  const [requestValues, setRequestValues] = useState<Record<string, string>>({});
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});

  function setMessage(key: string, message: string) {
    setMessages((prev) => ({ ...prev, [key]: message }));
  }

  function save(item: OwnerConfigItem) {
    const type = valueType(item);
    const raw = drafts[item.key] ?? "";
    if (type !== "boolean" && raw.trim() === "") {
      setMessage(item.key, "Enter a value.");
      return;
    }
    if (
      (type === "integer" || type === "number") &&
      !Number.isFinite(Number(raw))
    ) {
      setMessage(item.key, "Enter a number.");
      return;
    }
    setPendingKey(item.key);
    setMessage(item.key, "");
    startTransition(async () => {
      try {
        const result = await setOwnerConfigValueAction({
          key: item.key,
          value: fromInputValue(item, raw),
        });
        setMessage(item.key, result.ok ? "Saved." : result.error);
        if (result.ok) {
          setDrafts((prev) => ({ ...prev, [item.key]: raw }));
          router.refresh();
        }
      } catch {
        setMessage(
          item.key,
          "The change did not reach the server. Check the value and retry.",
        );
      } finally {
        setPendingKey(null);
      }
    });
  }

  function requestChange(item: OwnerConfigItem) {
    setPendingKey(item.key);
    setMessage(item.key, "");
    startTransition(async () => {
      try {
        const result = await requestConfigChangeAction({
          key: item.key,
          requestedValue: requestValues[item.key] ?? "",
          ...(requestNotes[item.key]?.trim()
            ? { note: requestNotes[item.key]?.trim() }
            : {}),
        });
        setMessage(
          item.key,
          result.ok ? "Request sent to the platform." : result.error,
        );
        if (result.ok) {
          setRequestValues((prev) => ({ ...prev, [item.key]: "" }));
          setRequestNotes((prev) => ({ ...prev, [item.key]: "" }));
        }
      } catch {
        setMessage(
          item.key,
          "The request did not reach the platform. Try again.",
        );
      } finally {
        setPendingKey(null);
      }
    });
  }

  const schemaNumber = (
    item: OwnerConfigItem,
    field: "minimum" | "maximum",
  ): number | undefined => {
    const value = item.jsonSchema[field];
    return typeof value === "number" ? value : undefined;
  };

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const structured = isStructured(item);
        return (
          <section
            key={item.key}
            className="rounded-card bg-paper border border-line p-4"
            data-testid={`config-${item.key}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-ink">
                {KEY_TITLES[item.key] ?? item.description}
              </p>
              <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
                {scopeLabel(item)}
              </span>
            </div>
            {KEY_TITLES[item.key] ? (
              <p className="mt-0.5 text-[12px] text-ink-3">{item.description}</p>
            ) : null}

            {item.editable && !structured ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block grow min-w-[12rem]">
                  <span className="block text-[12px] font-medium text-ink-2 mb-1">
                    Current value
                  </span>
                  {valueType(item) === "boolean" ? (
                    <Select
                      value={drafts[item.key] ?? "false"}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      
                    >
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </Select>
                  ) : (
                    <Input
                      type={
                        valueType(item) === "integer" ||
                        valueType(item) === "number"
                          ? "number"
                          : "text"
                      }
                      min={schemaNumber(item, "minimum")}
                      max={schemaNumber(item, "maximum")}
                      step={valueType(item) === "integer" ? 1 : undefined}
                      value={drafts[item.key] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      
                    />
                  )}
                </label>
                <Button
            variant="primary"
            size="md"
            className="inline-flex items-center justify-center"
            type="button"
                  disabled={pending && pendingKey === item.key}
                  onClick={() => save(item)}
          >
                  {pending && pendingKey === item.key ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-[13px] text-ink-3">
                  Current value:{" "}
                  <span className="font-medium text-ink-2">
                    {readOnlyValue(item)}
                  </span>{" "}
                  · {scopeLabel(item)}
                </p>
                {item.key === "operations.business_hours" ? (
                  <p className="mt-2 text-[12.5px] text-ink-3">
                    Opening hours are set for each location.{" "}
                    <Link
                      href="/owner/settings/locations"
                      className="text-[var(--accent-ink)] underline underline-offset-2"
                    >
                      Edit hours in Locations
                    </Link>
                    .
                  </p>
                ) : null}
                {structured && item.key !== "operations.business_hours" ? (
                  <p className="mt-2 text-[12.5px] text-ink-3">
                    This setting has a structured value and is edited from
                    its own workspace, not as a single field here.
                  </p>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-[var(--accent-ink)] underline underline-offset-2">
                    Request change
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label className="block">
                      <span className="block text-[12px] font-medium text-ink-2 mb-1">
                        What should it be?
                      </span>
                      <Input
                        value={requestValues[item.key] ?? ""}
                        onChange={(e) =>
                          setRequestValues((prev) => ({
                            ...prev,
                            [item.key]: e.target.value,
                          }))
                        }
                        
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[12px] font-medium text-ink-2 mb-1">
                        Why? (optional)
                      </span>
                      <Input
                        value={requestNotes[item.key] ?? ""}
                        onChange={(e) =>
                          setRequestNotes((prev) => ({
                            ...prev,
                            [item.key]: e.target.value,
                          }))
                        }
                        
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        (pending && pendingKey === item.key) ||
                        (requestValues[item.key] ?? "").trim().length === 0
                      }
                      onClick={() => requestChange(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-pill border border-line px-4 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
                    >
                      Send request
                    </button>
                  </div>
                </details>
              </div>
            )}

            {messages[item.key] ? (
              <p
                role="status"
                className="mt-2 rounded-ctl bg-deck px-3 py-2 text-[12px] text-ink-2"
              >
                {messages[item.key]}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
