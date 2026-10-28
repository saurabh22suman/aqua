"use client";

import type { ChangeEvent, KeyboardEvent, Ref } from "react";
import { DateField } from "@/components/ui/DateField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type {
  InlineEditFieldName,
  InlineEditFieldOption,
  InlineEditFieldType,
} from "@/components/member-detail/inline-edit-field";

// The inline editor's editing control, split out of
// InlineEditField to keep that module within the line budget.

const FIELD_LABELS: Record<InlineEditFieldName, string> = {
  fullName: "name",
  phone: "phone number",
  dateOfBirth: "date of birth",
  gender: "gender",
  medicalNotes: "medical notes",
};

export { FIELD_LABELS };

export function InlineEditControl({
  field,
  type,
  draft,
  options,
  placeholder,
  inputRef,
  onDraftChange,
  onCommit,
  onBlur,
  onKeyDown,
}: {
  field: InlineEditFieldName;
  type: InlineEditFieldType;
  draft: string;
  options?: InlineEditFieldOption[];
  placeholder?: string;
  inputRef: Ref<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  onDraftChange: (value: string) => void;
  onCommit: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const label = FIELD_LABELS[field];

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    onDraftChange(e.target.value);
  }

  if (type === "select") {
    return (
      <Select
        ref={inputRef as Ref<HTMLSelectElement>}
        value={draft}
        onChange={(e) => {
          // Select inputs save on change — no blur step needed.
          onDraftChange(e.target.value);
          onCommit(e.target.value);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown as (e: KeyboardEvent<HTMLSelectElement>) => void}
        aria-label={label}
        className="min-w-[140px]"
      >
        <option value="">—</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }

  if (type === "textarea") {
    return (
      <Textarea
        ref={inputRef as Ref<HTMLTextAreaElement>}
        value={draft}
        onChange={handleChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown as (e: KeyboardEvent<HTMLTextAreaElement>) => void}
        placeholder={placeholder}
        aria-label={label}
        rows={2}
        className="min-w-[200px]"
      />
    );
  }

  if (type === "date") {
    return (
      <DateField
        inputRef={inputRef as Ref<HTMLInputElement>}
        value={draft}
        onChange={(iso) => {
          onDraftChange(iso);
          // DateField only emits a complete valid date, so a partial
          // keypress never reaches the server.
          if (iso) onCommit(iso);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown as (e: KeyboardEvent<HTMLInputElement>) => void}
        aria-label={label}
        className="h-11 min-w-[140px]"
      />
    );
  }

  return (
    <Input
      ref={inputRef as Ref<HTMLInputElement>}
      type="text"
      value={draft}
      onChange={handleChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown as (e: KeyboardEvent<HTMLInputElement>) => void}
      placeholder={placeholder}
      aria-label={label}
      className="min-w-[140px]"
    />
  );
}
