"use client";

import { Ticket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LinkQr } from "@/components/link-qr";
import { Button } from "@/components/ui/Button";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";
import {
  ENTRY_WINDOW_RULE,
  type BookingEntryPassView,
  type MintEntryPassResult,
} from "./booking-entry-shared";

// The guest-facing entry pass.
//
// Presentational on purpose: it receives `onMintPass` from its container and
// never imports a server action or a database module. The contract test mounts
// it with a fake mint callback; the real container supplies the real action.
//
// Eligibility is the server's view, not a client calculation:
//   * cancelled / completed / unavailable (held or unrecognised) / already
//     checked in -> no pass;
//   * no `bookings.read` -> no pass;
//   * refunded / unpaid / partly paid -> no pass.
//
// Privacy:
//   * the minted token lives only in this component's state;
//   * it is encoded by the existing LinkQr/qrcode primitive and never rendered
//     as text, an accessible label, a URL, a copy control or a log line;
//   * share/download is only on an explicit press: a PNG is encoded in memory
//     from the same token, the system share sheet is invoked directly, and a
//     temporary image object URL is revoked after a download click;
//   * Hide pass and the expiry timer clear it;
//   * a server refusal is shown by its safe sentence, never by a raw error.
//
// The 30-minute window is a server rule. The pass states the rule (and the
// server window state) but never admits from the browser clock.
//
// v3 closed-window rule: the approved contract copy is already rendered by
// `windowCopy` ("Entry closed at <time>. Ask the counter if you need help.").
// This component does NOT add a second sentence and does NOT block the whole
// pass section. It suppresses the unminted "Show entry pass" control when the
// server says the window is closed, because mint would refuse. An already
// minted pass stays visible: it is a pass, not an admission, and the scan is
// the authority.

// A small clock-skew guard: never hide a pass the server might still accept.
// The server is authoritative; this timer is advisory only.
const MIN_EXPIRY_TIMER_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;

// Sharing/saving is an explicit export of the QR image, never of the token
// text. The PNG is built in memory from the same token; its intermediate data
// URL is consumed immediately, and the download path revokes its object URL.
const PASS_IMAGE_FILENAME = "entry-pass.png";

function pngBytesFromDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> {
  const comma = dataUrl.indexOf(",");
  if (
    comma < 0 ||
    !dataUrl.slice(0, comma).toLowerCase().includes(";base64")
  ) {
    throw new Error("QR image");
  }
  // Consume the base64 payload immediately. It is never attached to the DOM,
  // written to storage or logged; it only becomes the in-memory PNG bytes.
  const binary = atob(dataUrl.slice(comma + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function passImageFile(token: string): Promise<File> {
  // Reuse the installed `qrcode` package lazily, as LinkQr does. `toDataURL`
  // returns PNG bytes for the token; no network call and no token URL is made.
  const { toDataURL } = await import("qrcode");
  const pngDataUrl = await toDataURL(token, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
  });
  return new File([pngBytesFromDataUrl(pngDataUrl)], PASS_IMAGE_FILENAME, {
    type: "image/png",
  });
}

function isShareCancellation(error: unknown): boolean {
  // Safari/Chrome reject a cancelled share sheet with AbortError. Some embed
  // the same name on a plain Error, so check the shape rather than `instanceof`.
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && error.name === "AbortError";
}

function blockedCopy(booking: BookingEntryPassView): string | null {
  // Order matters: a cancelled booking stays cancelled even if it was paid;
  // a completed booking is not an admission; a held or unrecognised status
  // is refused as `unavailable` without wording that claims a cancellation;
  // an existing entry is the strongest "do not offer another pass" state.
  //
  // Deliberately NO closed-window branch here. The approved closed copy lives
  // in `windowCopy`, and a minted pass must remain visible outside the window.
  if (booking.bookingStatus === "cancelled") {
    return "This booking was cancelled. Entry is not available.";
  }
  if (booking.bookingStatus === "completed") {
    return "This booking is complete. Entry is not available.";
  }
  if (booking.bookingStatus === "unavailable") {
    // Covers held, unknown, future and missing statuses alike: entry is
    // refused, but nothing here says the booking was cancelled.
    return "Entry is not available because this booking is not confirmed. Check it at the counter.";
  }
  if (booking.checkedInAt) {
    return "This guest is already checked in.";
  }
  if (!booking.canMint) {
    return "Entry passes are not available for your permission. Ask an owner or manager.";
  }
  if (booking.paymentState === "refunded") {
    return "The payment for this booking was refunded. Entry is not available.";
  }
  if (booking.paymentState !== "paid") {
    return "This booking is not paid in full. Collect the payment at the counter before showing a pass.";
  }
  return null;
}

function windowCopy(booking: BookingEntryPassView): string {
  const entryWindow = booking.entryWindow;
  if (entryWindow?.state === "too_early") {
    return `Entry opens at ${formatTimeIST(entryWindow.opensAt)}. You can show this pass in advance.`;
  }
  if (entryWindow?.state === "closed") {
    return `Entry closed at ${formatTimeIST(entryWindow.closesAt)}. Ask the counter if you need help.`;
  }
  if (entryWindow?.state === "open") {
    return "Entry is open now.";
  }
  return ENTRY_WINDOW_RULE;
}

export function BookingEntryPass({
  booking,
  onMintPass,
}: {
  booking: BookingEntryPassView;
  onMintPass: () => Promise<MintEntryPassResult>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [canShareImages, setCanShareImages] = useState(false);
  const busyRef = useRef(false);
  const imageBusyRef = useRef(false);

  const blocked = blockedCopy(booking);

  // Detect PNG-file sharing after mount so the server and first client render
  // agree. A tiny probe File avoids offering a share control on a browser that
  // has the API but cannot share files; the click path checks again.
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function" ||
      typeof navigator.canShare !== "function" ||
      typeof File !== "function"
    ) {
      setCanShareImages(false);
      return;
    }
    try {
      const probe = new File([new Uint8Array([0])], PASS_IMAGE_FILENAME, {
        type: "image/png",
      });
      setCanShareImages(navigator.canShare({ files: [probe] }) === true);
    } catch {
      setCanShareImages(false);
    }
  }, []);

  // Advisory expiry. Do not hide a pass earlier than the server might accept
  // it (phone clock skew); if the server returns an already-past expiry, leave
  // the display to the server's scan refusal rather than flickering the pass.
  useEffect(() => {
    if (!token || !expiresAt) return;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) return;
    const remaining = expiry - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => {
        setToken(null);
        setExpiresAt(null);
        setImageError(null);
        setExpired(true);
      },
      Math.min(Math.max(remaining, MIN_EXPIRY_TIMER_MS), MAX_TIMER_MS),
    );
    return () => window.clearTimeout(timer);
  }, [token, expiresAt]);

  async function mint() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setExpired(false);
    setImageError(null);
    try {
      const result = await onMintPass();
      if (result.ok) {
        setToken(result.token);
        setExpiresAt(result.expiresAt);
      } else {
        setToken(null);
        setExpiresAt(null);
        setError(result.error || "The pass could not be created. Try again.");
      }
    } catch {
      // Never log or echo the caught error: it may contain transport detail.
      setToken(null);
      setExpiresAt(null);
      setError("The pass could not be created. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function hide() {
    setToken(null);
    setExpiresAt(null);
    setExpired(false);
    setError(null);
    setImageError(null);
  }

  async function downloadImage() {
    if (!token || imageBusyRef.current) return;
    imageBusyRef.current = true;
    setImageBusy(true);
    setImageError(null);
    let objectUrl: string | null = null;
    try {
      const file = await passImageFile(token);
      // Only the PNG blob gets an object URL. The token is never the URL.
      objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = PASS_IMAGE_FILENAME;
      link.click();
    } catch {
      setImageError("The pass image could not be saved. Try again.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      imageBusyRef.current = false;
      setImageBusy(false);
    }
  }

  async function shareImage() {
    if (!token || imageBusyRef.current) return;
    imageBusyRef.current = true;
    setImageBusy(true);
    setImageError(null);
    try {
      const file = await passImageFile(token);
      if (
        typeof navigator.share !== "function" ||
        typeof navigator.canShare !== "function" ||
        !navigator.canShare({ files: [file] })
      ) {
        setImageError(
          "Sharing files is not available in this browser. Use Download pass image.",
        );
        return;
      }
      // Explicit press only. The share sheet is the only recipient; nothing is
      // sent automatically and no token text is placed in the payload.
      await navigator.share({ files: [file], title: "Entry pass" });
    } catch (error) {
      if (!isShareCancellation(error)) {
        setImageError(
          "The pass could not be shared. Use Download pass image.",
        );
      }
    } finally {
      imageBusyRef.current = false;
      setImageBusy(false);
    }
  }

  if (blocked) {
    return (
      <section
        data-testid="booking-entry-pass"
        aria-labelledby="booking-entry-pass-heading"
        className="rounded-card border border-line bg-deck p-4"
      >
        <div className="flex items-center gap-2">
          <Ticket
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            className="text-ink-3"
          />
          <h2
            id="booking-entry-pass-heading"
            className="font-display text-[16px] font-semibold text-ink"
          >
            Entry pass
          </h2>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">{blocked}</p>
        <p className="mt-3 text-[12px] text-ink-3">
          {booking.facilityName} · {formatDateIST(booking.startsAt)} ·{" "}
          {formatTimeIST(booking.startsAt)}–{formatTimeIST(booking.endsAt)}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="booking-entry-pass"
      aria-labelledby="booking-entry-pass-heading"
      className="rounded-card border border-line bg-deck p-4"
    >
      <div className="flex items-center gap-2">
        <Ticket
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="text-ink-3"
        />
        <h2
          id="booking-entry-pass-heading"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Entry pass
        </h2>
      </div>

      <p className="mt-2 text-[15px] font-semibold text-ink">
        {booking.facilityName}
      </p>
      <p className="text-[12.5px] text-ink-2">
        {formatDateIST(booking.startsAt)} ·{" "}
        {formatTimeIST(booking.startsAt)}–{formatTimeIST(booking.endsAt)}
      </p>
      <p className="mt-2 text-[12px] text-ink-3">{windowCopy(booking)}</p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
        >
          {error}
        </p>
      ) : null}

      {expired ? (
        <p
          role="alert"
          className="mt-3 rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
        >
          This pass has expired. Show a new pass.
        </p>
      ) : null}

      {token ? (
        <div className="mt-4">
          <div
            data-testid="booking-entry-pass-qr"
            role="img"
            aria-label="Entry pass QR code for this booking"
            className="mx-auto w-full max-w-[220px]"
          >
            <LinkQr
              url={token}
              size={220}
              onError={() => {
                setToken(null);
                setExpiresAt(null);
                setImageError(null);
                setError("The QR could not be drawn. Try again.");
              }}
            />
          </div>
          <p className="mt-3 text-[13px] font-medium text-ink">
            Show this at the counter.
          </p>
          {expiresAt ? (
            <p className="mt-1 text-[12px] text-ink-3">
              Valid until {formatDateIST(expiresAt)},{" "}
              {formatTimeIST(expiresAt)}.
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {imageError ? (
              <p
                role="alert"
                className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
              >
                {imageError}
              </p>
            ) : null}
            {imageBusy ? (
              <p role="status" className="text-[12px] text-ink-3">
                Preparing the pass image…
              </p>
            ) : null}
            {canShareImages ? (
              <Button
                variant="secondary"
                size="md"
                className="w-full"
                onClick={() => void shareImage()}
                disabled={imageBusy}
              >
                Share pass image
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void downloadImage()}
              disabled={imageBusy}
            >
              Download pass image
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={hide}
            >
              Hide pass
            </Button>
          </div>
        </div>
      ) : booking.entryWindow?.state === "closed" ? null : (
        <div className="mt-4 space-y-2">
          {busy ? (
            <p role="status" className="text-[13px] text-ink-3">
              Preparing the pass…
            </p>
          ) : null}
          {error ? (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => void mint()}
              disabled={busy}
            >
              Try again
            </Button>
          ) : expired ? (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => void mint()}
              disabled={busy}
            >
              Show a new pass
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => void mint()}
              disabled={busy}
            >
              Show entry pass
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
