"use client";

import { useActionState } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPaymentQrAction,
  deletePaymentQrAction,
  updatePaymentQrAction,
} from "@/lib/actions/payment-qrs";
import type {
  PaymentQrRow,
  QrMutationResult,
} from "@/lib/services/payment-qrs";

// C-35 — owner/admin management of payment QRs: several per tenant,
// each nicknamed; UPI-generated or an uploaded image. Reception reads
// these through the same service (the collect screen), never edits.

// 16px per DESIGN.md §2: anything smaller triggers iOS zoom-on-focus.
const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none";

function AddUpiForm() {
  const [state, formAction, isPending] = useActionState(createPaymentQrAction, {
    ok: false,
    error: "",
  } as QrMutationResult);
  return (
    <form action={formAction} method="post" suppressHydrationWarning className="space-y-3">
      <input type="hidden" name="kind" value="upi" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Nickname
          </span>
          <input name="nickname" required maxLength={60} placeholder="Office account" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            UPI ID
          </span>
          <input name="upiId" required maxLength={120} placeholder="club@okhdfcbank" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Payee name
          </span>
          <input name="payeeName" required maxLength={120} placeholder="Sharma Sports" className={inputClass} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Add UPI QR"}
        </button>
        {!state.ok && state.error ? (
          <span role="alert" className="text-[12px] text-ink-2">
            {state.error}
          </span>
        ) : null}
        {state.ok ? (
          <span role="status" className="text-[12px] text-ink-3">
            Saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}

function AddImageForm() {
  const [state, formAction, isPending] = useActionState(createPaymentQrAction, {
    ok: false,
    error: "",
  } as QrMutationResult);
  return (
    <form action={formAction} method="post" suppressHydrationWarning className="space-y-3">
      <input type="hidden" name="kind" value="image" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Nickname
          </span>
          <input name="nickname" required maxLength={60} placeholder="Bank QR" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            QR image (PNG, JPEG or WebP, max 256 KB)
          </span>
          <input
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp"
            required
            className="block w-full text-[16px] text-ink-2"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Add image QR"}
        </button>
        {!state.ok && state.error ? (
          <span role="alert" className="text-[12px] text-ink-2">
            {state.error}
          </span>
        ) : null}
        {state.ok ? (
          <span role="status" className="text-[12px] text-ink-3">
            Saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}

function QrRow({ qr }: { qr: PaymentQrRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [nickname, setNickname] = useState(qr.nickname);
  const [upiId, setUpiId] = useState(qr.upiId ?? "");
  const [payeeName, setPayeeName] = useState(qr.payeeName ?? "");

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updatePaymentQrAction({
        id: qr.id,
        nickname,
        ...(qr.kind === "upi" ? { upiId, payeeName } : {}),
        isActive: qr.isActive,
      });
      setMessage(result.ok ? "Saved." : result.error);
      if (result.ok) router.refresh();
    });
  }

  function toggleActive() {
    setMessage(null);
    startTransition(async () => {
      const result = await updatePaymentQrAction({
        id: qr.id,
        isActive: !qr.isActive,
      });
      setMessage(result.ok ? "Updated." : result.error);
      if (result.ok) router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${qr.nickname}"?`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deletePaymentQrAction({ id: qr.id });
      setMessage(result.ok ? "Deleted." : result.error);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">
          {qr.nickname}
          <span className="ml-2 rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
            {qr.kind === "upi" ? "UPI" : "Image"}
          </span>
          {!qr.isActive ? (
            <span className="ml-2 rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
              Inactive
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={toggleActive}
            className="rounded-pill border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
          >
            {qr.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            className="rounded-pill border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-start gap-3">
        {qr.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/payment-qr/${qr.id}/image`}
            alt={`${qr.nickname} QR`}
            className="h-20 w-20 rounded-ctl border border-line bg-paper object-contain p-1"
          />
        ) : (
          <p className="text-[12px] text-ink-3">
            {qr.upiId} · {qr.payeeName}
          </p>
        )}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-[var(--accent)] underline underline-offset-2">
          Edit
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">
              Nickname
            </span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputClass} />
          </label>
          {qr.kind === "upi" ? (
            <>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  UPI ID
                </span>
                <input value={upiId} onChange={(e) => setUpiId(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Payee name
                </span>
                <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className={inputClass} />
              </label>
            </>
          ) : (
            <p className="text-[12px] text-ink-3 sm:col-span-2">
              To replace an image QR, delete it and add a new one.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="mt-3 rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </details>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function PaymentQrManager({ qrs }: { qrs: PaymentQrRow[] }) {
  return (
    <div className="space-y-8">
      <section className="rounded-card bg-paper border border-line p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Add a UPI QR
        </h2>
        <p className="mt-1 mb-4 text-[12px] text-ink-3">
          The app draws the QR from your UPI ID, so the collect screen can
          put the amount straight into the payment request.
        </p>
        <AddUpiForm />
      </section>

      <section className="rounded-card bg-paper border border-line p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Add an image QR
        </h2>
        <p className="mt-1 mb-4 text-[12px] text-ink-3">
          For a bank or merchant QR that is already an image. The amount
          cannot be pre-filled on these.
        </p>
        <AddImageForm />
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Your QRs
        </h2>
        {qrs.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
            No payment QRs yet. Add one above to show it at reception.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {qrs.map((qr) => (
              <QrRow key={qr.id} qr={qr} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
