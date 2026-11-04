import type { HTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";

// Owner OpenPen — the one content inset convention.
//
// The shell content wrapper adds NO horizontal padding. The page owns its
// inset explicitly: 16px on a phone and 28px on desktop, measured from
// the content-column edge to the first content. Pages that used `px-5`
// inside the old 32px shell gutter replace that wrapper with this one;
// there is never a 32+20 double gutter.
//
// Vertical spacing stays with the page (`className`) because a form and a
// long ledger do not share one top/bottom rhythm.
export function OwnerPage({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-owner-page
      className={cn("px-4 pb-8 pt-6 lg:px-7 lg:pb-7 lg:pt-7", className)}
      {...rest}
    />
  );
}
