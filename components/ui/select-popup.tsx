"use client";

import type { MouseEvent } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { cn } from "./cn";
import type { SelectBounds } from "./select-geometry";
import type { SelectOption } from "./select-options";

// UI foundation — the open listbox of the shared Select.
//
// The listbox is the popup of the control, not a menu: it is a list of
// OPTIONS (one of them is the control's value), not a list of actions.
// It therefore carries listbox/option semantics and never menu/menuitem
// semantics, and the selected option is marked with a drawn tick and
// the word itself — never with colour alone.
//
// The options are the native control's own options (see
// select-options.ts), so the popup and the control can never disagree
// about what is selected, what is disabled, or which text an option
// carries.
//
// The listbox is named after the control it belongs to (the control's
// own label, plus " options"): it is a named list of options, not an
// anonymous panel — and it is NOT named like the control itself, so
// nothing that looks a control up by its name finds two of them.

export type SelectPopupProps = {
  /** The listbox's id: the control points at it with aria-controls. */
  id: string;
  /** The listbox's accessible name: the control's own name. */
  name: string;
  options: SelectOption[];
  /** The option the keyboard is on. */
  activeIndex: number;
  /** Where the popup may sit, measured from the control. */
  bounds: SelectBounds | null;
  onActiveChange: (index: number) => void;
  onChoose: (value: string) => void;
};

/** The options, split into the groups the control declares. */
function sectionsOf(options: SelectOption[]) {
  const sections: Array<{
    group: string | null;
    items: Array<{ option: SelectOption; index: number }>;
  }> = [];
  options.forEach((option, index) => {
    const last = sections[sections.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else sections.push({ group: option.group, items: [{ option, index }] });
  });
  return sections;
}

export function SelectPopup({
  id,
  name,
  options,
  activeIndex,
  bounds,
  onActiveChange,
  onChoose,
}: SelectPopupProps) {
  const above = bounds?.placement === "above";

  return (
    <div
      id={id}
      role="listbox"
      aria-label={name}
      style={{
        maxHeight: bounds ? `${bounds.maxHeight}px` : undefined,
        width: bounds ? `${bounds.width}px` : undefined,
        marginLeft: bounds && bounds.offset !== 0 ? `${bounds.offset}px` : undefined,
        overflowY: "auto",
      }}
      className={cn(
        "absolute left-0 z-[var(--z-overlay)] overscroll-contain rounded-ctl border border-line p-1 shadow-2",
        "bg-[var(--control-surface-picker)]",
        above ? "bottom-full mb-1" : "top-full mt-1",
      )}
      // The press must not move the focus off the control, and it must
      // not reach a label that wraps the control — the label would
      // activate the control a second time.
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.preventDefault()}
      onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      {sectionsOf(options).map((section) => {
        const rows = section.items.map(({ option, index }) => (
          <div
            key={`${option.value}-${index}`}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={option.selected}
            aria-disabled={option.disabled ? true : undefined}
            onMouseEnter={() => {
              if (!option.disabled) onActiveChange(index);
            }}
            onClick={() => {
              if (option.disabled) return;
              onChoose(option.value);
            }}
            className={cn(
              "flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-ctl px-3 py-2 text-left",
              "text-[16px] leading-snug text-ink motion-fast transition-colors",
              index === activeIndex
                ? "bg-[var(--control-surface-action-hover)]"
                : "hover:bg-[var(--control-surface-action)]",
              option.selected && "font-medium",
              option.disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
            )}
          >
            {/* The tick column is always there, so the options line up
                with each other; only the chosen one carries the mark. */}
            <span className="flex h-5 w-5 flex-none items-center justify-center">
              {option.selected ? (
                <Check size={14} strokeWidth={2.2} aria-hidden="true" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 break-words whitespace-normal">
              {option.label}
            </span>
          </div>
        ));

        if (!section.group) return rows;
        return (
          <div key={section.group} role="group" aria-label={section.group}>
            {/* The group caption is drawn, but the group's name is
                already on the group itself — the caption must not be
                announced twice. */}
            <p
              aria-hidden="true"
              className="px-3 pt-2 pb-1 text-[12px] font-medium text-ink-3"
            >
              {section.group}
            </p>
            {rows}
          </div>
        );
      })}
    </div>
  );
}
