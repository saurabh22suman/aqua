import type { MouseEventHandler } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

// Owner create action — FOUNDATION lane, 2 November 2026.
//
// The shared create affordance for the owner product. ONE accessible
// link that is two things at once:
//
//   - on a phone: the round floating action above the bottom
//     navigation (56px, the mock's `.fab`), and
//   - on a desktop: the inline labelled primary action in the page
//     header.
//
// The API is the one the contract fixes:
//
//   OwnerCreateAction({ href, label, testId?, className? })
//
// The caller owns the permission: the page server gates the action
// BEFORE it renders this component, so this file carries no permission
// logic and no data.
//
// The clearance is CONDITIONAL. The action is marked with
// `data-owner-create-action`, and the owner scope in app/globals.css
// reads that marker with `:has()` to grow the content's bottom
// clearance — so a page WITHOUT an action keeps the plain navigation
// clearance, and a page WITH one reserves the action's footprint too.
// No JavaScript is involved: the component is a server-rendered link.
//
// The geometry follows the approved mock:
//
//   .fab { position:fixed; right:16px;
//          bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom));
//          width:56px; height:56px; border-radius:50%; }
//
// SAME-PAGE FRAGMENT ACTIONS — the actual Chrome journey (journeys r2)
// failed here: the booking desk's action points at the real
// "#new-booking" form, but the FRAMEWORK link intercepted the click, so
// the browser never performed its own fragment navigation: the form was
// not scrolled to and not focused ("Booking create action focuses
// actual form" FAILED, while the source-level test passed).
//
// A fragment action is therefore a NATIVE anchor — the browser's own
// fragment navigation scrolls to the target and moves focus to it when
// the target is focusable. A REAL ROUTE keeps the framework link, which
// is what client-side navigation needs. Nothing else changes: the same
// attributes, the same glyph, the same label, the same classes, no
// handler, no automatic selection and no mutation.
//
// RED PROVENANCE: this file was first written as the smallest
// importable shell (a plain link) so that owner-create-action.test.tsx
// could fail on the INTENDED behaviour — the floating geometry, the
// desktop inline form and the clearance marker — and not on a missing
// module. The fragment focus failure above was captured afterwards as
// its own intended RED.
//
// THE BUTTON VARIANT (3 November 2026) — the Root's whole-owner
// requirement: EVERY owner create affordance follows THIS pattern,
// including the pages whose create affordance is a CLIENT action
// (Programs and Enquiries open a create panel in the browser instead
// of navigating to a route). Those pages fell back to an ordinary
// boxed "Add" button: a different shape, a different affordance and
// no clearance marker.
//
// The shared action therefore gained ONE more shape — the SAME control,
// activated by the client's own callback:
//
//   OwnerCreateAction({ href, label, … })                 route/fragment
//   OwnerCreateAction({ kind: "button", onClick, label, … })
//
// The two are a strictly typed, mutually exclusive union: the link
// variant never takes an onClick and the button variant never takes an
// href. The module stays SERVER-COMPATIBLE — no "use client", no
// hooks, no state — so the server pages keep rendering a plain link
// and never pull client JavaScript in for it. The button variant is
// for a client parent that ALREADY owns the callback; this component
// adds no permission, no domain logic and no selection of its own.

export type OwnerCreateActionLinkProps = {
  /** Where the action goes. The caller owns the permission. */
  href: string;
  /** The visible (desktop) label and the accessible name. */
  label: string;
  /** An optional stable hook for a lane's own test. */
  testId?: string;
  /** Extra classes from the caller. */
  className?: string;
  /** The link variant is never activated by a callback. */
  onClick?: never;
  /**
   * The variant that navigates. It is the default, so every existing
   * call stays exactly as it was.
   */
  kind?: "link";
};

export type OwnerCreateActionButtonProps = {
  /**
   * The client parent's own callback: it opens the page's create
   * panel. This component never owns that state.
   */
  onClick: MouseEventHandler<HTMLButtonElement>;
  /** The visible (desktop) label and the accessible name. */
  label: string;
  /** An optional stable hook for a lane's own test. */
  testId?: string;
  /** Extra classes from the caller. */
  className?: string;
  /** The button variant is never a destination. */
  href?: never;
  /** The variant that activates a callback instead of navigating. */
  kind: "button";
};

export type OwnerCreateActionProps =
  | OwnerCreateActionLinkProps
  | OwnerCreateActionButtonProps;

/**
 * The ONE class map of the create action. The link variant and the
 * button variant are the same control, so they are drawn from the same
 * map — there is no second geometry to drift.
 */
function createActionClasses(className: string): string {
  return [
    // The shared control base: a real control target and a visible
    // keyboard ring, whatever shape the action takes.
    "inline-flex items-center justify-center gap-2 font-medium transition-colors",
    "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
    // A native button draws neither the link's pointer cursor nor the
    // browser's own button appearance: the button variant has to be
    // the same control as the link, not a second one.
    "cursor-pointer appearance-none",
    // The phone: one round floating action above the navigation.
    // The fallback keeps the action above the navigation even in a
    // checkout that has not received the owner shell tokens yet.
    "fixed right-4 z-50 h-14 w-14 min-h-14 rounded-full bottom-[var(--owner-fab-bottom,calc(64px_+_16px_+_env(safe-area-inset-bottom)))]",
    "bg-[var(--action-surface)] text-[var(--action-foreground)] shadow-lg hover:bg-[var(--action-surface-hover)]",
    // The desktop: the inline labelled primary action.
    "lg:static lg:h-auto lg:w-auto lg:min-h-12 lg:rounded-ctl lg:px-4 lg:py-2.5 lg:text-[16px] lg:shadow-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The ONE content of the create action: one plus and one label. */
function createActionContent(label: string) {
  return (
    <>
      {/* The plus is visible on EVERY viewport — the human requires a
          consistent + wherever creating fits. On a phone it is the
          floating action's 24px glyph; on a desktop it sits beside the
          label at 20px (the Root's Chrome check needs at least 18px and
          measured `display: none`, width 0 before this fix). The label is
          still the accessible name; the glyph stays decorative. */}
      <OwnerIcon name="plus" size={24} className="lg:h-5 lg:w-5" />
      {/* The label is the accessible name on a phone (where only the
          glyph is drawn) and the visible word on a desktop. */}
      <span className="sr-only lg:not-sr-only">{label}</span>
    </>
  );
}

export function OwnerCreateAction(props: OwnerCreateActionProps) {
  const { label, testId = "owner-create-action", className = "" } = props;

  const shared = {
    "data-owner-create-action": "",
    "data-testid": testId,
    className: createActionClasses(className),
  };

  const content = createActionContent(label);

  if (props.kind === "button") {
    // The button variant: the same control, activated by the client
    // parent's own callback. `type="button"` is explicit — a create
    // action inside a form must never submit that form.
    return (
      <button {...shared} type="button" onClick={props.onClick}>
        {content}
      </button>
    );
  }

  // A same-page fragment ("#new-booking") is the BROWSER's navigation:
  // it scrolls to the target and focuses it. A route is the framework's
  // navigation.
  const isSamePageFragment = props.href.startsWith("#");

  if (isSamePageFragment) {
    return (
      <a href={props.href} {...shared}>
        {content}
      </a>
    );
  }
  return (
    <Link href={props.href} {...shared}>
      {content}
    </Link>
  );
}
