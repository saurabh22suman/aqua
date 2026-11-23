// F01 — the browser-side one-time operation key.
//
// The SERVER is the recovery source of truth (payment_intents); this key
// is only the identity of the attempt while it is in flight and a local
// cache for a retry on the same page. It is a random UUID, never derived
// from the amount, the member or the document.
//
// A browser without a usable CSPRNG gets null: the callers refuse the
// submission visibly and send NO request, rather than minting a weak or
// guessable key.
export function mintPaymentKey(): string | null {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (
    typeof uuid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  ) {
    return null;
  }
  return uuid;
}
