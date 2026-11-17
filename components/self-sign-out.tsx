"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

// LEAVING THE MEMBER OR FAMILY VIEW.
//
// This ends the PURPOSE-SCOPED self-service session and nothing else. It
// calls POST /api/self/logout, which revokes the scoped session row and
// clears the scoped cookie. It never calls a staff sign-out, never ends a
// staff session and never touches the account: a club staff sign-in on
// this device deliberately stays active.
//
// THE COPY SAYS SO. A button labelled "Sign out" would promise something
// this button does not do, and on a shared club device that promise
// matters: the person is leaving the member view, not the account.
//
// THE EXIT IS A FULL DOCUMENT, HISTORY-REPLACING NAVIGATION. A soft
// router navigation would leave the private home in the client router
// cache, and a later Back would paint that private view again from the
// cache after the scoped cookie was cleared. The full load drops that
// cache and replaces this entry, so Back has nothing of this view left
// to restore.
//
// THIS COMPONENT HOLDS NO PRIVATE RECORD. The scoped cookie is the
// door's to clear and the staff cookie is untouched, so there is no
// field here to clear: what leaves is the page itself.

export function SelfSignOut({ audience }: { audience: "member" | "guardian" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    audience === "member" ? "Leave member view" : "Leave family view";
  const signInPath =
    audience === "member" ? "/member/sign-in" : "/family/sign-in";

  async function leave(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/self/logout", { method: "POST" });
      if (!response.ok) {
        setError("We could not leave this view. Try again.");
        return;
      }
      // A FULL DOCUMENT, HISTORY-REPLACING NAVIGATION to the matching
      // sign-in. The private view must not survive in the client router
      // cache for a later Back to paint.
      window.location.replace(signInPath);
    } catch {
      setError("We could not reach the club's server. Try again when you are online.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void leave()}
      >
        {busy ? "Leaving…" : label}
      </Button>
      <p className="mt-1 text-[12px] leading-snug text-ink-3">
        Any staff sign-in on this device stays active.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] leading-snug text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
