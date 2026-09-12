"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Pencil } from "lucide-react";
import { updateMemberAction } from "@/lib/actions/people";
import { formatPhoneIN } from "@/lib/phone";

// Member-detail inline edit. Replaces the read-only field block on
// /owner/members/[id] with a click-to-edit affordance for the five
// fields a coach/owner usually has to fix (name typo, wrong phone,
// DOB entered a year off, gender, medical notes). Status transitions,
// enrolment, parent link, consent, attendance are still owned by their
// own flows — out of scope per docs/owner-fixes.md.
//
// Save on blur (text/textarea) or change (date/select). Optimistic
// update: the displayed text changes immediately on commit; on failure,
// we revert and show an inline error. No save/cancel button.

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
  snapshot: InlineEditSnapshot;
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
  snapshot,
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

  useEffect(() => {
    // Sync local state when the canonical value prop changes — parent
    // re-fetched, navigation back to the page, etc. Critically this
    // must NOT depend on `editing`: when commit() exits edit mode,
    // editing transitions from true to false, and a [value, editing]
    // dep would fire and clobber the optimistic displayValue update.
    setDraft(value);
    setDisplayValue(value);
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

  async function commit(newValue: string) {
    if (newValue === displayValue && status.kind !== "error") {
      setEditing(false);
      setStatus({ kind: "idle" });
      return;
    }
    // Optimistic update — display the new value immediately, exit edit
    // mode. If the server rejects, we revert below.
    setDisplayValue(newValue);
    setDraft(newValue);
    setEditing(false);
    setStatus({ kind: "saving" });
    try {
      const result = await updateMemberAction({
        memberId,
        fullName:
          field === "fullName" ? newValue : snapshot.fullName,
        phone:
          field === "phone"
            ? newValue || undefined
            : snapshot.phone ?? undefined,
        dateOfBirth:
          field === "dateOfBirth" ? newValue : snapshot.dateOfBirth ?? "",
        gender:
          field === "gender"
            ? newValue || undefined
            : snapshot.gender ?? undefined,
        locationId: snapshot.locationId,
        medicalNotes:
          field === "medicalNotes"
            ? newValue || undefined
            : snapshot.medicalNotes ?? undefined,
      });
      if (!result.ok) {
        setDisplayValue(value);
        setDraft(value);
        setStatus({ kind: "error", message: result.error });
        return;
      }
      setStatus({ kind: "saved" });
    } catch (err) {
      setDisplayValue(value);
      setDraft(value);
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      void commit(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(displayValue);
      setEditing(false);
      setStatus({ kind: "idle" });
    }
  }

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const newValue = e.target.value;
    setDraft(newValue);
    // Date and select inputs save on change — no blur step needed.
    // A date input's onChange fires when the user picks a day; a
    // <select>'s onChange fires on pick. For text/textarea the user
    // finishes with blur or Enter.
    if (type === "date" || type === "select") {
      void commit(newValue);
    }
  }

  function handleBlur() {
    if (status.kind === "saving") return;
    if (!editing) return;
    void commit(draft);
  }

  function enterEdit() {
    setDraft(displayValue);
    setStatus({ kind: "idle" });
    setEditing(true);
  }

  const baseInputClass =
    "rounded-ctl border border-line bg-paper px-3 text-[16px] focus:outline-none focus:border-[var(--accent)]";

  return (
    <div className={className}>
      <div className="group inline-flex items-center gap-1">
        {editing ? (
          type === "select" ? (
            <select
              ref={inputRef as React.RefObject<HTMLSelectElement>}
              value={draft}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              aria-label={field}
              className={`${baseInputClass} h-11 pr-7`}
            >
              <option value="">—</option>
              {(options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : type === "textarea" ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label={field}
              rows={2}
              className={`${baseInputClass} py-2 min-w-[200px]`}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={type === "date" ? "date" : "text"}
              lang={type === "date" ? "en-IN" : undefined}
              value={draft}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? (type === "date" ? "dd/mm/yyyy" : undefined)}
              aria-label={field}
              className={`${baseInputClass} h-11 min-w-[140px]`}
            />
          )
        ) : (
          <>
            <span className={valueClassName ?? "text-[13px]"}>
              {(formatAs === "phone" ? formatPhoneIN(displayValue) : displayValue) ||
                placeholder ||
                "—"}
            </span>
            <button
              type="button"
              onClick={enterEdit}
              aria-label={`Edit ${field}`}
              className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-ctl text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-deck focus-visible:bg-deck"
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