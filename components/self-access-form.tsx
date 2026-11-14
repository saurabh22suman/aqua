"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { PhoneField } from "@/components/auth/phone-field";
import { PinField } from "@/components/auth/pin-field";
import { Button } from "@/components/ui/Button";
import { formatPhoneIN, normaliseToE164 } from "@/lib/phone";

// THE MEMBER AND FAMILY SIGN-IN FORM.
//
// An existing account signs in with the mobile number and PIN for their own club account. There is NO pre-PIN lookup, no club search, no person
// search and no discovery API: the form asks for two things and the
// door answers.
//
// IT NEVER TOUCHES THE STAFF SESSION. It calls the self-service door
// (/api/self/login/pin), which mints the purpose-scoped cookie and
// nothing else: no staff sign-in, no staff sign-out, no offline drafts,
// no offline sync. The member and family views are online-only.
//
// EVERY FAILURE IS THE SAME GENERIC MESSAGE. The door refuses with one
// answer for a wrong number, a wrong PIN, a locked account and a
// throttled attempt, so this form never becomes an oracle for which one
// it was. The fields are never cleared by a refusal: the person can
// correct one character and try again.
//
// A SUCCESS GOES ONLY TO A SERVER-RETURNED ALLOWLISTED PATH. The door
// answers with the home path; anything else is treated as a failure.
//
// A SUCCESS LEAVES THE PAGE ENTIRELY. The navigation is a FULL DOCUMENT
// load that REPLACES this history entry, never a soft router
// navigation: a soft navigation leaves the private home in the client
// router cache, and a later Back would paint that private view again
// from the cache long after the session is gone. The full load drops
// that cache and takes the number and the PIN with it, so nothing is
// left behind for the Back button to find.
//
// The invitation form is the sibling module
// (components/self-invitation-form.tsx); the shared helpers below are
// exported for it, so both doors answer the same way.

export const PIN_RULE = /^\d{6,12}$/;

/** The ONLY two places a member or family session may land. */
export const ALLOWED_HOME_PATHS = ["/member", "/family"] as const;

export type SelfAudience = "member" | "guardian";

export function homePathFor(audience: SelfAudience): "/member" | "/family" {
  return audience === "member" ? "/member" : "/family";
}

/** Move the focus to a field by id — the shared fields are not refs. */
export function focusField(id: string): void {
  const element = document.getElementById(id);
  if (element instanceof HTMLElement) element.focus();
}

/** The canonical form of the number, shown when the field is left. */
function formatLocal(value: string): string {
  const canonical = normaliseToE164(value);
  return /^\+91\d{10}$/.test(canonical) ? formatPhoneIN(canonical) : value;
}

/** Enter in a field submits the form, and only the form. */
export function submitOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== "Enter") return;
  if (event.nativeEvent.isComposing) return;
  const form = event.currentTarget.form;
  if (!form) return;
  event.preventDefault();
  form.requestSubmit();
}

export function SelfSignInForm({
  audience,
  clubId,
}: {
  audience: SelfAudience;
  clubId?: string;
}) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [pinBlurred, setPinBlurred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pinValid = PIN_RULE.test(pin);
  // The rule is only complained about once the field has been left.
  const pinError =
    pinBlurred && pin.length > 0 && !pinValid
      ? "Your PIN needs 6 to 12 digits."
      : null;
  const canSubmit = phone.trim().length > 0 && pinValid && !busy;

  function showCanonical(): void {
    setPhone((current) =>
      current.trim().length > 0 ? formatLocal(current) : current,
    );
  }

  async function submit(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/self/login/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: normaliseToE164(phone),
          pin,
          audience,
          // The club selector is the club's TENANT id. It goes into the
          // request and NOWHERE else — never into a URL, never into the
          // scope resolver, which compares slugs.
          ...(clubId ? { clubId } : {}),
        }),
      });
      if (!response.ok) {
        setError(
          "That number and PIN did not match. Check them and try again, or ask your club for help.",
        );
        focusField(phone.trim().length > 0 ? "self-pin" : "self-phone");
        return;
      }
      const data = (await response.json()) as {
        kind?: string;
        homePath?: string;
      };
      const home = data.homePath;
      if (
        data.kind !== "ok" ||
        typeof home !== "string" ||
        !(ALLOWED_HOME_PATHS as readonly string[]).includes(home) ||
        home !== homePathFor(audience)
      ) {
        setError("We could not sign you in just now. Try again in a moment.");
        return;
      }
      // THE NUMBER AND THE PIN LEAVE THE PAGE'S MEMORY with the door.
      setPhone("");
      setPin("");
      setRevealed(false);
      setPinBlurred(false);
      // A FULL DOCUMENT, HISTORY-REPLACING NAVIGATION. A soft router
      // navigation would leave the private home in the client router
      // cache, and a later Back would paint it again from that cache
      // after the session is gone. The full load drops that cache, and
      // the replaced entry leaves nothing for Back to restore.
      window.location.replace(home);
    } catch {
      setError(
        "We could not reach the club's server. Check your connection and try again.",
      );
      focusField("self-phone");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;
    void submit();
  }

  return (
    <div>
      <h1 className="font-display font-semibold text-ink">
        {audience === "member" ? "Member sign in" : "Family sign in"}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        {audience === "member"
          ? "Use the mobile number and PIN for your club account."
          : "Use the mobile number and PIN for your own club account."}
      </p>

      <form onSubmit={onSubmit} aria-busy={busy} className="space-y-5">
        <PhoneField
          id="self-phone"
          value={phone}
          onChange={setPhone}
          onBlur={showCanonical}
          onKeyDown={submitOnEnter}
        />
        <PinField
          id="self-pin"
          value={pin}
          onChange={setPin}
          onBlur={() => setPinBlurred(true)}
          onKeyDown={submitOnEnter}
          revealed={revealed}
          onToggleRevealed={() => setRevealed((current) => !current)}
          invalid={pinError !== null}
          error={pinError ?? undefined}
        />
        {error ? (
          <p
            role="alert"
            data-testid="self-form-error"
            className="text-[13px] leading-relaxed text-ink-2"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          pill
          disabled={!canSubmit}
          className="w-full disabled:opacity-40"
        >
          {busy ? "One moment…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-1">
        <Link
          href={audience === "member" ? "/family/sign-in" : "/member/sign-in"}
          className="flex min-h-[44px] items-center text-[14px] text-ink-2 underline underline-offset-2"
        >
          {audience === "member"
            ? "Signing in for your family?"
            : "Signing in for yourself?"}
        </Link>
        <Link
          href={audience === "member" ? "/member/activate" : "/family/activate"}
          className="flex min-h-[44px] items-center text-[14px] text-ink-2 underline underline-offset-2"
        >
          Got an invitation link?
        </Link>
      </div>
    </div>
  );
}
