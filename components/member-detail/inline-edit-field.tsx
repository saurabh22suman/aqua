"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Pencil } from "lucide-react";
import { updateMemberAction } from "@/lib/actions/people";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import {
  FIELD_LABELS,
  InlineEditControl,
} from "@/components/member-detail/inline-edit-control";

// Member-detail inline edit for the five fields a coach/owner usually
// fixes (name, phone, DOB, gender, medical notes). Save on blur
// (text/textarea) or change (date/select). The display updates
// optimistically; on failure it reverts, keeps the attempted draft and
// shows an inline error. Writes are field-scoped (owner-UI review P1).

export type InlineEditFieldName =
  | "fullName"
  | "phone"
  | "dateOfBirth"
  | "gender"
  | "medicalNotes";

export type InlineEditFieldType = "text" | "date" | "select" | "textarea";

export type InlineEditSnapshot = {
  fullName: string;
  dateOfBirth: string | null;
  locationId: string;
  phone: string | null;
  gender: string | null;
  medicalNotes: string | null;
};

export type InlineEditFieldOption = { value: string; label: string };

export type InlineEditFieldProps = {
  value: string;
  field: InlineEditFieldName;
  memberId: string;
  type: InlineEditFieldType;
  options?: InlineEditFieldOption[];
  placeholder?: string;
  className?: string;
  valueClassName?: string;
  // Retained for existing callers/tests from the pre-patch contract.
  // Writes are field-scoped now, so the snapshot is not consulted.
  snapshot?: InlineEditSnapshot;
  // Display-only formatting for the read branch, expressed as a
  // serializable enum because server components cannot pass functions
  // across the RSC boundary. The editing input and the committed value
  // always keep the stored form, so formatting never round-trips into
  // a write.
  formatAs?: "phone";
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const SAVED_INDICATOR_MS = 4000;

export function InlineEditField({
  value,
  field,
  memberId,
  type,
  options,
  placeholder,
  className,
  valueClassName,
  formatAs,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [secondsAgo, setSecondsAgo] = useState(0);
  const inputRef = useRef<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  >(null);
  // P1 (2026-10-13 owner-UI review) — each commit sends ONLY the field
  // being edited, and commits for this field are serialised so a
  // slower earlier request cannot land after a newer one and restore
  // an older value.
  const commitChain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    // Sync when the canonical prop changes (parent re-fetch, navigation
    // back). Must NOT depend on `editing` — that would clobber the
    // optimistic displayValue when commit() exits edit mode. A failed
    // save keeps `draft` so the attempted value is not lost.
    setDisplayValue(value);
    setDraft((current) => (status.kind === "error" ? current : value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement && type === "text") {
        inputRef.current.select();
      }
    }
  }, [editing, type]);

  useEffect(() => {
    if (status.kind !== "saved") return;
    setSecondsAgo(0);
    const interval = window.setInterval(() => {
      setSecondsAgo((s) => s + 1);
    }, 1000);
    const timeout = window.setTimeout(() => {
      setStatus({ kind: "idle" });
    }, SAVED_INDICATOR_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [status]);

  function payloadFor(newValue: string) {
    switch (field) {
      case "fullName":
        return { memberId, fullName: newValue.trim() };
      case "phone":
        return { memberId, phone: newValue.trim() || null };
      case "dateOfBirth":
        return { memberId, dateOfBirth: newValue };
      case "gender":
        return { memberId, gender: (newValue || null) as "male" | "female" | "other" | null };
      case "medicalNotes":
        return { memberId, medicalNotes: newValue.trim() || null };
    }
  }

  // The server-echoed persisted value in this field's display form;
  // falls back to the client value when the action omits the field.
  function persistedValue(
    patch: Record<string, unknown>,
    fallback: string,
  ): string {
    const key =
      field === "dateOfBirth"
        ? "dateOfBirth"
        : field;
    if (!(key in patch)) return fallback;
    const stored = patch[key];
    return typeof stored === "string" ? stored : "";
  }

  async function commit(newValue: string) {
    if (newValue === displayValue && status.kind !== "error") {
      setEditing(false);
      setStatus({ kind: "idle" });
      return;
    }
    // Optimistic update; on rejection revert the display but keep the
    // attempted draft so the user can retry without retyping.
    setDisplayValue(newValue);
    setDraft(newValue);
    setEditing(false);
    setStatus({ kind: "saving" });
    const patch = payloadFor(newValue);
    const run = commitChain.current.then(
      () => updateMemberAction(patch),
      () => updateMemberAction(patch),
    );
    commitChain.current = run.catch(() => undefined);
    try {
      const result = await run;
      if (!result.ok) {
        setDisplayValue(value);
        setStatus({ kind: "error", message: result.error });
        return;
      }
      // Reflect what the server actually persisted (trimming/nulls)
      // rather than only the guessed client value.
      const stored = result.value
        ? persistedValue({ ...patch, ...result.value }, newValue)
        : newValue;
      setDisplayValue(stored);
      setDraft(stored);
      setStatus({ kind: "saved" });
    } catch (err) {
      setDisplayValue(value);
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      // Same rule as blur: an incomplete date is a cancel.
      if (type === "date" && !draft) {
        setDraft(displayValue);
        return;
      }
      void commit(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(displayValue);
      setEditing(false);
      setStatus({ kind: "idle" });
    }
  }

  function handleBlur() {
    if (status.kind === "saving") return;
    if (!editing) return;
    // An incomplete/cleared date is a cancel, not a wipe — DOB is
    // required, and emitting "" would optimistically blank the field.
    if (type === "date" && !draft) {
      setDraft(displayValue);
      setEditing(false);
      return;
    }
    void commit(draft);
  }

  function enterEdit() {
    // Keep the attempted value after a failed save for a quick retry.
    setDraft(status.kind === "error" ? draft : displayValue);
    setStatus({ kind: "idle" });
    setEditing(true);
  }


  // Empty fields style the placeholder as editable and keep the pencil
  // visible. Dates read as `22 Aug`, never raw ISO; the draft stays ISO.
  const shown =
    formatAs === "phone"
      ? formatPhoneIN(displayValue)
      : type === "date" && displayValue
        ? formatDateIST(displayValue)
        : displayValue;
  const isEmpty = !shown;

  return (
    <div className={className}>
      <div className="group inline-flex items-center gap-1">
        {editing ? (
          <InlineEditControl
            field={field}
            type={type}
            draft={draft}
            options={options}
            placeholder={placeholder}
            inputRef={inputRef}
            onDraftChange={setDraft}
            onCommit={(value) => void commit(value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <>
            <span className={isEmpty ? "text-[13px] text-[var(--accent-ink)] underline underline-offset-2" : valueClassName ?? "text-[13px]"}>
              {shown || placeholder || "—"}
            </span>
            <button
              type="button"
              onClick={enterEdit}
              aria-label={`Edit ${FIELD_LABELS[field] ?? field}`}
              className={`flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-ctl text-ink-3 transition-opacity duration-150 hover:bg-deck focus-visible:bg-deck ${isEmpty ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"}`}
            >
              <Pencil size={14} />
            </button>
          </>
        )}
      </div>
      {status.kind === "saved" ? (
        <p
          className="mt-1 text-[11px] text-ink-3"
          aria-live="polite"
        >
          Saved · {secondsAgo}s ago
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="mt-1 text-[11px] text-ink-2" role="alert">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}