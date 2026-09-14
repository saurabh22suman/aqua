"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestConfigChangeAction,
  setOwnerConfigValueAction,
} from "@/lib/actions/owner-config";

// O-07 — the registry-rendered owner settings form. Editable keys get
// an inline control; read-only keys show the current value greyed with
// a Request change disclosure. Values are rendered from the key's
// jsonSchema, never hardcoded per key.

type OwnerItem = {
  key: string;
  value: unknown;
  visibility: "owner_edit" | "owner_read";
  risk: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  source: {
    scopeType: string;
    scopeId: string | null;
    setBy: string | null;
    setAt: string | null;
  };
  editable: boolean;
};

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none";

function valueType(item: OwnerItem): string {
  const type = item.jsonSchema["type"];
  return typeof type === "string" ? type : "string";
}

function toInputValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return String(value);
}

function fromInputValue(item: OwnerItem, raw: string): unknown {
  const type = valueType(item);
  if (type === "boolean") return raw === "true";
  if (type === "integer" || type === "number") return Number(raw);
  return raw;
}

function renderSource(item: OwnerItem): string {
  if (item.source.scopeType === "default") return "platform default";
  const scope = item.source.scopeId
    ? `${item.source.scopeType}: ${item.source.scopeId}`
    : item.source.scopeType;
  return scope;
}

export function OwnerConfigForm({ items }: { items: OwnerItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.key, toInputValue(item.value)])),
  );
  const [requestValues, setRequestValues] = useState<Record<string, string>>({});
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});

  function save(item: OwnerItem) {
    setPendingKey(item.key);
    setMessages((prev) => ({ ...prev, [item.key]: "" }));
    startTransition(async () => {
      const result = await setOwnerConfigValueAction({
        key: item.key,
        value: fromInputValue(item, drafts[item.key] ?? ""),
      });
      setMessages((prev) => ({
        ...prev,
        [item.key]: result.ok ? "Saved." : result.error,
      }));
      if (result.ok) router.refresh();
      setPendingKey(null);
    });
  }

  function requestChange(item: OwnerItem) {
    setPendingKey(item.key);
    setMessages((prev) => ({ ...prev, [item.key]: "" }));
    startTransition(async () => {
      const result = await requestConfigChangeAction({
        key: item.key,
        requestedValue: requestValues[item.key] ?? "",
        ...(requestNotes[item.key]?.trim()
          ? { note: requestNotes[item.key]?.trim() }
          : {}),
      });
      setMessages((prev) => ({
        ...prev,
        [item.key]: result.ok
          ? "Request sent to the platform."
          : result.error,
      }));
      if (result.ok) {
        setRequestValues((prev) => ({ ...prev, [item.key]: "" }));
        setRequestNotes((prev) => ({ ...prev, [item.key]: "" }));
      }
      setPendingKey(null);
    });
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <section
          key={item.key}
          className="rounded-card bg-paper border border-line p-4"
          data-testid={`config-${item.key}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[14px] font-medium text-ink">{item.description}</p>
            <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
              {renderSource(item)}
            </span>
          </div>

          {item.editable ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block grow min-w-[12rem]">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Current value
                </span>
                {valueType(item) === "boolean" ? (
                  <select
                    value={drafts[item.key] ?? "false"}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                ) : (
                  <input
                    type={valueType(item) === "integer" || valueType(item) === "number" ? "number" : "text"}
                    value={drafts[item.key] ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))
                    }
                    className={inputClass}
                  />
                )}
              </label>
              <button
                type="button"
                disabled={pending && pendingKey === item.key}
                onClick={() => save(item)}
                className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
              >
                {pending && pendingKey === item.key ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-[13px] text-ink-3">
                Current value:{" "}
                <span className="font-medium text-ink-2">
                  {typeof item.value === "boolean"
                    ? item.value
                      ? "On"
                      : "Off"
                    : String(item.value ?? "—")}
                </span>{" "}
                · changed by the platform
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-[var(--accent)] underline underline-offset-2">
                  Request change
                </summary>
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="block text-[12px] font-medium text-ink-2 mb-1">
                      What should it be?
                    </span>
                    <input
                      value={requestValues[item.key] ?? ""}
                      onChange={(e) =>
                        setRequestValues((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[12px] font-medium text-ink-2 mb-1">
                      Why? (optional)
                    </span>
                    <input
                      value={requestNotes[item.key] ?? ""}
                      onChange={(e) =>
                        setRequestNotes((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      (pending && pendingKey === item.key) ||
                      (requestValues[item.key] ?? "").trim().length === 0
                    }
                    onClick={() => requestChange(item)}
                    className="rounded-pill border border-line px-4 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
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
      ))}
    </div>
  );
}
