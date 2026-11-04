"use client";

import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import Menu from "lucide-react/dist/esm/icons/menu.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { Button } from "@/components/ui/Button";
import { OpsNavLinks } from "./ops-nav-links";

// Ops redesign (28 October 2026) — the phone Menu.
//
// The phone's four-item bottom bar (Overview / Tenants / Catalogue /
// Presets) is retained unchanged, as approved. It cannot carry every
// destination, so the remaining ones (Leads, WhatsApp, Activity log)
// live behind this toggle.
//
// The toggle is a real button with `aria-expanded` and `aria-controls`,
// and the panel it controls is always in the DOM (so the relationship
// is announced) — it is hidden with the `hidden` attribute when
// closed, which keeps it out of the accessibility tree and out of the
// tab order.
//
// The panel's landmark is named "Platform menu", not "Platform": the
// desktop rail owns the "Platform" landmark, and two identically
// named landmarks would make "go to the platform navigation" ambiguous
// for a screen-reader user.
//
// The two elements are returned as a fragment so the panel becomes a
// direct flex child of the phone bar and can take a full row of its
// own when it opens.

export function OpsMobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pathname = usePathname();

  // The Menu CLOSES when the operator navigates. The panel lives in the
  // layout, which is preserved across a navigation, so an open Menu
  // would otherwise stay open over the page the operator just chose —
  // covering the heading and the form they came for. The pathname is
  // the signal, so the Back button closes it too.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="order-2"
      >
        {open ? (
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Menu size={16} strokeWidth={1.8} aria-hidden="true" />
        )}
        {open ? "Close menu" : "Menu"}
      </Button>

      <nav
        id={panelId}
        aria-label="Platform menu"
        hidden={!open}
        className="order-3 w-full rounded-ctl border border-line bg-paper p-2"
      >
        <OpsNavLinks variant="menu" />
      </nav>
    </>
  );
}
