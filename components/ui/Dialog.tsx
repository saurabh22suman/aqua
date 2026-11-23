"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "./cn";

// UI foundation — Dialog.
//
// A native <dialog> opened with showModal(): the browser gives us the
// focus trap, the inert background, Escape handling and the top layer
// for free — no dependency, no half-implemented focus management.
//
// Two behaviours the native element does NOT give us, so the component
// owns them:
//   - the "cancel" event (Escape) is intercepted so the caller's state
//     stays the single source of truth,
//   - focus returns to whatever opened the dialog.
//
// Motion: opacity plus a small transform, 200ms, and the global
// reduced-motion rule removes it.

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Hide the close button when the dialog must be answered. */
  hideClose?: boolean;
  className?: string;
  /** Use only for sheets that can close without losing an unsaved operation. */
  swipeToClose?: boolean;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  hideClose,
  className,
  swipeToClose = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const dragStart = useRef<number | null>(null);
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      restoreFocusTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      return;
    }
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    // Escape: let the caller close it (and keep its state in step).
    event.preventDefault();
    onOpenChange(false);
  }

  function handleClose() {
    onOpenChange(false);
    restoreFocusTo.current?.focus?.();
  }

  return (
    <dialog
      ref={ref}
      onCancel={handleCancel}
      onClose={handleClose}
      data-ui-dialog
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "m-auto w-[min(560px,calc(100vw-2rem))] rounded-card border border-line bg-paper p-0 text-ink shadow-2",
        "backdrop:bg-marine/45",
        className,
      )}
    >
      {swipeToClose ? <div data-ui-dialog-grip aria-hidden="true"
        onPointerDown={event => {
          if (event.pointerType !== "touch" || !event.isPrimary) return;
          dragStart.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={event => {
          const delta = dragStart.current === null ? 0 : event.clientY - dragStart.current;
          dragStart.current = null;
          if (delta > 56) onOpenChange(false);
        }}
        onPointerCancel={() => { dragStart.current = null; }}
      /> : null}
      <div data-ui-dialog-header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <h2 id={titleId} className="font-display text-[16px] font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-[13px] text-ink-2">
              {description}
            </p>
          ) : null}
        </div>
        {hideClose ? null : (
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-ctl text-ink-3 motion-fast transition-colors hover:bg-deck"
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </div>
      {children ? <div data-ui-dialog-body className="px-5 py-4">{children}</div> : null}
      {footer ? (
        <div data-ui-dialog-footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
