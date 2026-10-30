"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  clipRect,
  findClipAncestor,
  isRectVisible,
  subscribeToViewportChanges,
  visibleViewportRect,
} from "./menu-bounds";
import { computeSelectBounds, type SelectBounds } from "./select-geometry";
import { matchByPrefix, nextEnabledIndex, typeaheadPrefix } from "./select-keyboard";
import {
  optionsSignature,
  readControlName,
  readSelectOptions,
  type SelectOption,
} from "./select-options";

// UI foundation — the controller of the shared select's popup.
//
// Everything the popup does that is not drawing lives here: which
// option is highlighted, where the popup may sit, when it opens and
// closes, and what a choice does to the control.
//
// The controller never invents a value: a choice is a real change on
// the real `<select>`, so the consumer's onChange receives the control
// itself as its target (components/ui/Select.tsx draws the control and
// wires the events).

/** How long a typed prefix stays alive before it starts again. */
const TYPEAHEAD_RESET_MS = 800;

export type SelectPopupController = {
  /** The listbox's id: the control points at it with aria-controls. */
  listboxId: string;
  /** The listbox's accessible name. */
  listboxName: string;
  open: boolean;
  activeIndex: number;
  options: SelectOption[];
  bounds: SelectBounds | null;
  openPopup: (edge?: "first" | "last") => void;
  closePopup: (restoreFocus: boolean) => void;
  chooseOption: (value: string) => void;
  moveActive: (direction: 1 | -1) => void;
  setActiveIndex: (index: number) => void;
  typeahead: (character: string) => void;
};

export function useSelectPopup(input: {
  selectRef: RefObject<HTMLSelectElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
  /** A multiple or tall select keeps the browser's own list box. */
  nativeList: boolean;
  /** The controlled value, so an outside change is noticed. */
  controlledValue: string | undefined;
  /** The control's own name, when it has one. */
  ariaLabel?: string;
}): SelectPopupController {
  const { selectRef, rootRef, nativeList, controlledValue, ariaLabel } = input;
  const listboxId = useId();
  const typeaheadRef = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [bounds, setBounds] = useState<SelectBounds | null>(null);
  const [listboxName, setListboxName] = useState("options");

  // The options are the control's own options: the popup reads them
  // from the DOM, so it can never disagree with the control about
  // what is selected, what is disabled, or which text an option
  // carries.
  const syncOptions = useCallback(() => {
    const next = readSelectOptions(selectRef.current);
    setOptions((previous) =>
      optionsSignature(previous) === optionsSignature(next) ? previous : next,
    );
  }, [selectRef]);

  useEffect(() => {
    syncOptions();
    const select = selectRef.current;
    if (!select) return;
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => syncOptions());
    observer?.observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "label", "value"],
    });
    // A choice made anywhere — by the popup, by the keyboard, by the
    // consumer — moves the selected option.
    select.addEventListener("change", syncOptions);
    return () => {
      observer?.disconnect();
      select.removeEventListener("change", syncOptions);
    };
  }, [syncOptions, selectRef]);

  // A controlled value can change from outside the control — React sets
  // the value property, which is neither a change event nor an
  // attribute mutation — so the popup has to look again.
  useEffect(() => {
    syncOptions();
  }, [syncOptions, controlledValue]);

  const closePopup = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      setActiveIndex(-1);
      if (restoreFocus) selectRef.current?.focus();
    },
    [selectRef],
  );

  const openPopup = useCallback(
    (edge: "first" | "last" = "first") => {
      const select = selectRef.current;
      if (!select || select.disabled || nativeList) return;
      const list = readSelectOptions(select);
      const selected = list.findIndex(
        (option) => option.selected && !option.disabled,
      );
      const available = list
        .map((option, index) => (option.disabled ? -1 : index))
        .filter((index) => index >= 0);
      const target =
        selected >= 0
          ? selected
          : edge === "last"
            ? (available[available.length - 1] ?? -1)
            : (available[0] ?? -1);
      setOptions(list);
      setActiveIndex(target);
      setListboxName(`${readControlName(select, ariaLabel)} options`);
      setOpen(true);
    },
    [ariaLabel, nativeList, selectRef],
  );

  const chooseOption = useCallback(
    (value: string) => {
      const select = selectRef.current;
      closePopup(true);
      if (!select || select.value === value) return;
      // A real change on the real control: the consumer's onChange
      // receives the control as its target and its currentTarget.
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [closePopup, selectRef],
  );

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      const index = nextEnabledIndex(options, activeIndex, direction);
      if (index >= 0) setActiveIndex(index);
    },
    [activeIndex, options],
  );

  const typeahead = useCallback(
    (character: string) => {
      const state = typeaheadRef.current;
      const now = Date.now();
      const text = typeaheadPrefix(state, character, now, TYPEAHEAD_RESET_MS);
      typeaheadRef.current = { text, at: now };
      const index = matchByPrefix(options, text, activeIndex);
      if (index >= 0) {
        setActiveIndex(index);
        return;
      }
      // The prefix leads nowhere: the letter on its own may still.
      if (text.length > 1) {
        const single = matchByPrefix(options, character, activeIndex);
        if (single >= 0) {
          typeaheadRef.current = { text: character, at: now };
          setActiveIndex(single);
        }
      }
    },
    [activeIndex, options],
  );

  const applyBounds = useCallback(() => {
    const select = selectRef.current;
    const root = rootRef.current;
    if (!select || !root) return;
    const box = select.getBoundingClientRect();
    const visible = visibleViewportRect();
    const clip = clipRect(findClipAncestor(root));
    if (!isRectVisible(box, visible, clip)) {
      // The control left the screen: the popup would float over
      // nothing, so it closes rather than hanging there.
      closePopup(false);
      return;
    }
    setBounds(computeSelectBounds({ trigger: box, visible, clip }));
  }, [closePopup, rootRef, selectRef]);

  // While the popup is open it follows the screen.
  useEffect(() => {
    if (!open) return;
    const ancestor = findClipAncestor(rootRef.current);
    const update = () => applyBounds();
    update();
    return subscribeToViewportChanges(ancestor, update);
  }, [open, applyBounds, rootRef]);

  // A press outside dismisses the popup. The focus is not pulled back —
  // whatever the user pressed keeps it.
  useEffect(() => {
    if (!open) return;
    function onDocumentMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePopup(false);
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open, closePopup, rootRef]);

  // The highlighted option is scrolled into the list: pointing at it
  // with aria-activedescendant does not move the list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const element = document.getElementById(`${listboxId}-option-${activeIndex}`);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex, listboxId]);

  return {
    listboxId,
    listboxName,
    open,
    activeIndex,
    options,
    bounds,
    openPopup,
    closePopup,
    chooseOption,
    moveActive,
    setActiveIndex,
    typeahead,
  };
}
