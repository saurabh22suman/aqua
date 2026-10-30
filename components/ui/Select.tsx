"use client";

import { forwardRef, useCallback, useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { SelectHTMLAttributes } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { cn } from "./cn";
import { enabledIndexes, popupKeyAction } from "./select-keyboard";
import { SelectPopup } from "./select-popup";
import { useSelectPopup } from "./use-select-popup";

// UI foundation — Select.
//
// The human reported (30 October 2026): "the dropdown is not looking
// good, its using the default one, instead of our custom css". The
// control styled the CLOSED select and left the OPEN menu to the
// operating system, so every shared select in the product opened the
// browser's own dropdown.
//
// The control is therefore still the native `<select>` — the same
// element, with the same `<option>` children, the same ref, the same
// form value — and the popup is drawn by us:
//
//   • the native dropdown is never allowed to open: a press on the
//     control is cancelled before the browser's default action, and the
//     keys that open a native dropdown are cancelled too;
//   • the popup is a listbox with option semantics (never menu
//     semantics), named after the control, and the chosen option
//     carries a drawn tick, so the state is never colour alone;
//   • the focus stays on the control while the popup is open (the
//     popup is the control's own listbox, referenced with
//     aria-controls/aria-activedescendant), so the inline editor's
//     blur-commit and the consumer's key handlers keep working;
//   • a choice is a REAL change on the REAL control: the value is set
//     on the `<select>` and a native change event is dispatched, so the
//     consumer's onChange receives the control itself as its target.
//
// Without JavaScript the control is still the native select and still
// works: the popup is an enhancement, not a replacement.
//
// A multiple select, or a select with `size` greater than one, keeps
// the native list box — the custom popup is for the single-choice
// control only.
//
// The REF is forwarded to the underlying `<select>`, not to the
// wrapper: an inline select (a control in a table row) has to be
// focusable and readable imperatively — the People lane's interface
// request R5.

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  // The data attributes the DOM accepts. A shared control that replaces
  // a raw `<select>` has to accept them too, or every consumer that
  // addressed its control by test id would have to change.
  [dataAttribute: `data-${string}`]: string | undefined;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      className,
      children,
      multiple,
      size,
      onChange,
      onBlur,
      onKeyDown,
      onClick,
      onMouseDown,
      ...rest
    },
    ref,
  ) {
    const selectRef = useRef<HTMLSelectElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    // A press on the control is handled here; the click that follows
    // it must not open the popup a second time.
    const pointerRef = useRef(false);

    // A multiple select, or a tall one, keeps the native list box.
    const nativeList = Boolean(multiple) || (typeof size === "number" && size > 1);
    const controlledValue = rest.value === undefined ? undefined : String(rest.value);

    const popup = useSelectPopup({
      selectRef,
      rootRef,
      nativeList,
      controlledValue,
      ariaLabel: rest["aria-label"],
    });

    const setSelectNode = useCallback(
      (node: HTMLSelectElement | null) => {
        selectRef.current = node;
        if (typeof ref === "function") {
          ref(node);
          return;
        }
        if (ref) (ref as { current: HTMLSelectElement | null }).current = node;
      },
      [ref],
    );

    function handleKeyDown(event: KeyboardEvent<HTMLSelectElement>) {
      const select = selectRef.current;
      if (!select || select.disabled || nativeList) {
        onKeyDown?.(event);
        return;
      }

      if (popup.open) {
        const action = popupKeyAction(event.key);
        if (!action) {
          onKeyDown?.(event);
          return;
        }
        switch (action.kind) {
          case "close":
            // The popup is the first layer: Escape closes it and goes
            // no further, so an enclosing dialog does not close too.
            if (action.swallow) {
              event.preventDefault();
              event.stopPropagation();
            }
            popup.closePopup(false);
            return;
          case "move":
            event.preventDefault();
            popup.moveActive(action.direction);
            return;
          case "edge": {
            event.preventDefault();
            const available = enabledIndexes(popup.options);
            popup.setActiveIndex(
              action.edge === "first"
                ? (available[0] ?? -1)
                : (available[available.length - 1] ?? -1),
            );
            return;
          }
          case "choose": {
            event.preventDefault();
            const option = popup.options[popup.activeIndex];
            // Nothing to choose (an empty or wholly disabled list): the
            // value must not be touched.
            if (!option || option.disabled) return;
            const changed = select.value !== option.value;
            popup.chooseOption(option.value);
            // Nothing changed, so the consumer still gets the key: an
            // inline editor commits the draft it holds.
            if (!changed) onKeyDown?.(event);
            return;
          }
          case "typeahead":
            event.preventDefault();
            popup.typeahead(action.character);
            return;
        }
      }

      // Closed: the consumer hears the key first. A consumer that
      // handles it (an inline editor commits on Enter) keeps that
      // behaviour; only then does the control open its own popup.
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
          event.preventDefault();
          popup.openPopup(event.key === "ArrowUp" ? "last" : "first");
          return;
        default:
          return;
      }
    }

    function handleMouseDown(event: ReactMouseEvent<HTMLSelectElement>) {
      const select = selectRef.current;
      if (!select || select.disabled || nativeList) {
        onMouseDown?.(event);
        return;
      }
      onMouseDown?.(event);
      const consumerHandled = event.defaultPrevented;
      // The browser opens its own dropdown on a press. Cancelling the
      // press stops that default action — the operating system's
      // picker never appears, whatever the consumer did with the key.
      event.preventDefault();
      if (consumerHandled) return;
      pointerRef.current = true;
      if (popup.open) {
        popup.closePopup(false);
        return;
      }
      select.focus();
      popup.openPopup("first");
    }

    function handleClick(event: ReactMouseEvent<HTMLSelectElement>) {
      const select = selectRef.current;
      if (!select || select.disabled || nativeList) {
        onClick?.(event);
        return;
      }
      onClick?.(event);
      const consumerHandled = event.defaultPrevented;
      // A label that wraps the control activates it with a click, and
      // that click must not open the browser's own dropdown either.
      event.preventDefault();
      if (consumerHandled) return;
      if (pointerRef.current) {
        pointerRef.current = false;
        return;
      }
      select.focus();
      if (!popup.open) popup.openPopup("first");
    }

    function handleBlur(event: React.FocusEvent<HTMLSelectElement>) {
      // The popup belongs to the control: when the control loses the
      // focus, the popup goes with it.
      popup.closePopup(false);
      onBlur?.(event);
    }

    const controlTestId = rest["data-testid"];
    const activeOptionId =
      popup.open && popup.activeIndex >= 0
        ? `${popup.listboxId}-option-${popup.activeIndex}`
        : undefined;

    return (
      <div ref={rootRef} className="relative block">
        <select
          ref={setSelectNode}
          className={cn(
            "min-h-12 w-full appearance-none rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface-picker)] py-2 pl-4 pr-9 text-[16px] text-ink",
            "motion-fast transition-colors",
            "hover:border-[var(--control-border-hover)]",
            "focus:border-[var(--accent-strong)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
          {...rest}
          multiple={multiple}
          size={size}
          onChange={onChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          aria-expanded={popup.open ? true : undefined}
          aria-controls={popup.open ? popup.listboxId : undefined}
          aria-activedescendant={activeOptionId}
        >
          {children}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          data-testid={controlTestId ? `${controlTestId}-chevron` : "select-chevron"}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
        />
        {popup.open ? (
          <SelectPopup
            id={popup.listboxId}
            name={popup.listboxName}
            options={popup.options}
            activeIndex={popup.activeIndex}
            bounds={popup.bounds}
            onActiveChange={popup.setActiveIndex}
            onChoose={popup.chooseOption}
          />
        ) : null}
      </div>
    );
  },
);
