"use client";

import { ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatTimeIST } from "@/lib/time/tz";
import type {
  BookingEntryScanEntry,
  BookingEntryScanResult,
} from "./booking-entry-shared";
import { useBookingEntryCamera } from "./use-booking-entry-camera";

// The staff-facing entry scanner.
//
// Presentational on purpose: it receives `onScan` and never imports a server
// action. The real container supplies the real `checkInBookingAction`; the
// contract tests inject a fake callback so no backend is pretended into
// existence.
//
// Camera honesty:
//   * permission is requested only after the staff member presses Start camera;
//   * the camera preview is local and nothing is uploaded;
//   * a denied/busy/missing camera keeps the manual token field usable and says
//     what happened;
//   * QR decoding uses the browser's BarcodeDetector when it exists; if it does
//     not, the UI says so and does not pretend to scan.
//
// Privacy:
//   * the token is cleared before the request is awaited;
//   * only the token is passed to `onScan`;
//   * the token is never rendered in a result, label, URL or log;
//   * a not-found refusal is generic and never names a tenant or location;
//   * arbitrary server error strings are not echoed; known refusal reasons have
//     this lane's copy, unknown reasons get a generic refusal.

type ScanOutcome =
  | { kind: "success"; message: string; entry: BookingEntryScanEntry }
  | { kind: "already_checked_in" | "refused" | "error"; message: string };

const REFUSAL_COPY: Record<string, string> = {
  not_paid: "Collect the payment before admitting this guest.",
  already_checked_in:
    "This guest is already checked in. Ask a staff member.",
  cancelled: "This booking was cancelled.",
  not_found: "Booking not found.",
  invalid_token: "That pass is not valid. Ask the counter to show a new pass.",
  not_authenticated: "Not authenticated. Sign in again.",
  // The winning service reasons (lib/services/booking-entry.ts REFUSAL_TEXT).
  // These replace the obsolete `outside_window` key: the service never returns
  // that reason, so mapping it left the counter on the generic fallback.
  not_confirmed: "This booking is not confirmed for entry.",
  not_in_window: "That pass cannot be used for this booking right now.",
};

const RESULT_TONE: Record<ScanOutcome["kind"], StatusTone> = {
  success: "good",
  // Already checked in is a different operational answer from a payment
  // refusal: four outcomes, four tones (good / water / warn / late), each
  // with a word as well as a colour.
  already_checked_in: "water",
  refused: "warn",
  error: "late",
};

const RESULT_LABEL: Record<ScanOutcome["kind"], string> = {
  success: "Checked in",
  already_checked_in: "Already checked in",
  refused: "Not admitted",
  error: "Could not check in",
};

function refusalMessage(reason: string): string {
  // Known reasons get the contract sentence. An unknown future reason gets a
  // generic refusal; the server's raw error string is not echoed, so a future
  // server mistake cannot leak tenant/location detail. Use an own-property
  // check so a reason such as "constructor" cannot reach Object.prototype.
  const copy = Object.prototype.hasOwnProperty.call(REFUSAL_COPY, reason)
    ? REFUSAL_COPY[reason]
    : undefined;
  return copy ?? "That pass could not be accepted. Ask a staff member.";
}

export function BookingEntryScanner({
  onScan,
}: {
  onScan: (token: string) => Promise<BookingEntryScanResult>;
}) {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ScanOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const camera = useBookingEntryCamera((raw) => {
    void submitToken(raw);
  });

  async function submitToken(raw: string) {
    const value = raw.trim();
    if (!value || busyRef.current) return;
    busyRef.current = true;
    // Clear the token before awaiting: a slow or failed request must not leave
    // it on screen. The result only carries a safe sentence.
    setToken("");
    setResult(null);
    camera.clearMessages();
    setPending(true);
    camera.stopCamera();
    try {
      const outcome = await onScan(value);
      if (outcome.ok) {
        const time = Number.isFinite(Date.parse(outcome.entry.checkedInAt))
          ? formatTimeIST(outcome.entry.checkedInAt)
          : "";
        setResult({
          kind: "success",
          entry: outcome.entry,
          message: time ? `Checked in at ${time}.` : "Checked in.",
        });
      } else {
        setResult({
          kind:
            outcome.reason === "already_checked_in"
              ? "already_checked_in"
              : "refused",
          message: refusalMessage(outcome.reason),
        });
      }
    } catch {
      // Never log or echo the caught error.
      setResult({
        kind: "error",
        message: "Check the connection and try again.",
      });
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  return (
    <section
      data-testid="booking-entry-scanner"
      aria-labelledby="booking-entry-scanner-heading"
      className="rounded-card border border-line bg-paper p-4"
    >
      <div className="flex items-start gap-2">
        <ScanLine
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="mt-0.5 flex-none text-ink-3"
        />
        <div className="min-w-0">
          <h2
            id="booking-entry-scanner-heading"
            className="font-display text-[16px] font-semibold text-ink"
          >
            Check in a guest
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Scan the entry pass QR, or enter the pass token.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button
          variant="secondary"
          size="md"
          className="w-full sm:w-auto"
          onClick={() => {
            if (camera.camera === "live") camera.stopCamera();
            else void camera.startCamera();
          }}
          disabled={camera.camera === "starting"}
        >
          {camera.camera === "live"
            ? "Stop camera"
            : camera.camera === "starting"
              ? "Starting camera…"
              : "Start camera"}
        </Button>
      </div>

      {camera.cameraError ? (
        <p
          role="alert"
          className="mt-3 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink"
        >
          {camera.cameraError}
        </p>
      ) : null}

      {camera.cameraNote ? (
        <p role="status" className="mt-3 text-[13px] text-ink-2">
          {camera.cameraNote}
        </p>
      ) : null}

      {camera.camera === "live" ? (
        <video
          ref={camera.videoRef}
          className="mt-3 aspect-[4/3] w-full max-w-[320px] rounded-ctl border border-line bg-deck object-cover"
          autoPlay
          muted
          playsInline
          aria-label="Camera preview for the pass QR"
        />
      ) : null}

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submitToken(token);
        }}
      >
        <Field
          id="booking-entry-scan-token"
          label="Pass token"
          description="Paste the pass token if the camera cannot read the QR."
        >
          {(field) => (
            <Input
              {...field}
              ref={inputRef}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="w-full"
          disabled={pending || token.trim().length === 0}
        >
          {pending ? "Checking in…" : "Check in"}
        </Button>
      </form>

      {result ? (
        <div
          data-testid="booking-entry-scan-result"
          data-result={result.kind}
          role={result.kind === "error" ? "alert" : "status"}
          className="mt-4 rounded-card border border-line bg-paper p-4"
        >
          <StatusBadge tone={RESULT_TONE[result.kind]}>
            {RESULT_LABEL[result.kind]}
          </StatusBadge>
          <p className="mt-2 text-[13.5px] text-ink">{result.message}</p>
          {result.kind === "error" ? (
            <Button
              variant="secondary"
              size="md"
              className="mt-3 w-full"
              onClick={() => {
                setResult(null);
                inputRef.current?.focus();
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
