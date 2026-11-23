"use client";

import { useId, useState, type ReactNode } from "react";
import ListFilter from "lucide-react/dist/esm/icons/list-filter.mjs";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

/** One set of controls. At phone widths a named button opens the editor. */
export function OwnerControlSheet({ label, value, title = label, children, immediate = false, alwaysSheet = false }: {
  label: string;
  value?: string;
  title?: string;
  children: ReactNode;
  immediate?: boolean;
  alwaysSheet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  return (
    <div className={`owner-control-sheet-slot${alwaysSheet ? " owner-control-sheet-always" : ""}`}>
      <button type="button" className="owner-control-sheet-trigger" aria-label={label}
        aria-describedby={value ? valueId : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {alwaysSheet ? <OwnerIcon name="calendar" size={17} /> : <ListFilter size={17} aria-hidden="true" />}
        <span id={value ? valueId : undefined}>{value ?? label}</span>
        <OwnerIcon name="down" size={13} />
      </button>
      {!open ? <div className="owner-control-sheet-inline">{children}</div> : null}
      <Dialog open={open} onOpenChange={setOpen} title={title} swipeToClose
        footer={immediate ? <Button type="button" onClick={() => setOpen(false)}>Done</Button> : undefined}>
        {open ? children : null}
      </Dialog>
    </div>
  );
}
