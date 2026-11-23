import type { ReactNode } from "react";
import { Field, type FieldControlProps } from "@/components/ui/Field";

// Owner redesign · People lane (C2) — the list/filter toolbar.
//
// The approved direction (docs/design/owner-redesign-20261027/contract.md):
//
//   "A toolbar aligns control bottoms. Labels sit consistently above
//    fields; no extra field margin changes the row alignment. Search
//    gets useful flexible width; pickers have bounded widths; mobile
//    wraps or stacks deliberately."
//
// This file owns the LAYOUT of those fields and nothing else. Every
// control inside it is the shared foundation primitive (`Field`, and
// through it `Input` / `Select` / `DateField`), so the shared sizing
// and tints stay with their owner and this lane never restates a
// height, a radius or a colour.
//
// The alignment mechanism is `items-end` on the row: each field is a
// label above its control, so the FIELD's bottom edge is the CONTROL's
// bottom edge and the controls share one baseline whatever the label
// says. No field carries its own bottom margin — a margin would lift
// that field's control off the shared baseline.

/** How much room a toolbar field may take. */
export type ToolbarFieldWidth = "flexible" | "bounded";

export function ListToolbar({
  label,
  children,
  className = "",
}: {
  /** Accessible name of the toolbar region. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      data-testid="list-toolbar"
      className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end ${className}`}
    >
      {children}
    </div>
  );
}

export function ToolbarField({
  id,
  label,
  children,
  width = "bounded",
  className = "",
}: {
  id: string;
  label: string;
  /** The shared control, wired with the ids `Field` hands back. */
  children: (props: FieldControlProps) => ReactNode;
  /** `flexible` is for a search entry, `bounded` for a picker. */
  width?: ToolbarFieldWidth;
  className?: string;
}) {
  return (
    <div
      data-testid="toolbar-field"
      className={`w-full min-w-0 sm:w-auto ${
        width === "flexible"
          ? "sm:flex-[2_1_240px]"
          : "sm:flex-[1_1_180px] sm:max-w-[220px]"
      } ${className}`}
    >
      <Field id={id} label={label}>
        {children}
      </Field>
    </div>
  );
}
