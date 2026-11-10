"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  armMembersReturnIntent,
  membersReturnHref,
} from "@/components/members-list-navigation";

// Owner People lane — the in-app return from a member profile.
//
// The member profile's "Members" control is the shared BackLink. On its
// own it opens a FRESH directory: the search, the status filter and the
// scroll position are lost (review finding F1). This owner-only client
// wrapper adds the ONE missing behaviour — it tells the directory that
// the owner is coming back from a profile, so the directory can restore
// the state it was left in.
//
// THE NAVIGATION IS TAKEN OVER, ON PURPOSE. next/link handles the click
// inside the <a>'s own handler (next/dist/client/app-dir/link.js): it
// calls `e.preventDefault()` and then dispatches the navigation. A
// handler on an ancestor that runs later — on the bubble — therefore
// finds `defaultPrevented === true`, gives up, and any navigation it
// issues is a SECOND one. That is exactly what the measured Chrome
// journey found: the return came back without the search.
//
// So the click is caught in the CAPTURE phase, before the <a>'s own
// handler: the return is armed, the child's navigation is prevented, and
// this wrapper issues the ONE navigation. A modified click (a new tab or
// window) is left to the browser: that view has no in-memory intent and
// shows the plain directory.
//
// The state it hands over is an explicit, single-use, in-memory return
// intent (components/members-list-navigation.ts): no URL parameter, no
// local or session storage, no person data, and no service, permission
// or auth change.

type LinkChildProps = {
  href?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function MembersReturnLink({ children }: { children: ReactNode }) {
  const router = useRouter();
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  if (!isValidElement(child)) return null;

  // Where the owner goes back to: the plain directory, or the scope the
  // directory was read under (the facility cookie may be absent).
  const destination = membersReturnHref();

  // The shared BackLink is the control — it does not take an onClick, so
  // the click is caught on a wrapper that generates NO box
  // (`display: contents`): the profile keeps the shared link's exact
  // layout, and only the click behaviour is added.
  return (
    <span
      className="contents"
      onClickCapture={(event: MouseEvent<HTMLSpanElement>) => {
        // A modified click opens another tab or window: the browser
        // keeps the plain link and that view shows the plain directory.
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        // Arm the return BEFORE the navigation is issued, so the
        // directory that comes back finds it.
        armMembersReturnIntent();
        // Take the navigation over: the child's own handler must not
        // run, or the app would navigate twice.
        event.preventDefault();
        event.stopPropagation();
        router.replace(destination);
      }}
    >
      {cloneElement(child as ReactElement<LinkChildProps>, {
        href: destination,
      })}
    </span>
  );
}
