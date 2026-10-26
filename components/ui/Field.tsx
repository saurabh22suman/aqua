import type { ReactNode } from "react";
import { Label } from "./Label";
import { FieldError } from "./FieldError";

// UI foundation — Field.
//
// One field shape for every form in the product: a real label, an
// optional description, the control, and the error beside the control
// (never in a summary at the top of the page). The control receives the
// ids through a render prop, so the association cannot be forgotten
// and the error text is what a screen reader announces.
//
//   <Field id="phone" label="Phone" error={error}>
//     {(field) => <Input {...field} />}
//   </Field>

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  required?: boolean;
};

export type FieldProps = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
};

export function Field({
  id,
  label,
  description,
  error,
  required,
  children,
}: FieldProps) {
  const descriptionId = description ? `${id}-description` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="min-w-0">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {description ? (
        <p id={descriptionId ?? undefined} className="mt-1 text-[12px] text-ink-3">
          {description}
        </p>
      ) : null}
      <div className="mt-1.5">
        {children({
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          "aria-required": required ? true : undefined,
          required,
        })}
      </div>
      {error ? (
        <FieldError id={errorId ?? undefined}>{error}</FieldError>
      ) : null}
    </div>
  );
}
