"use client";

import { useActionState } from "react";
import {
  injectInboundMessageAction,
  sendMockMessageAction,
  type WhatsAppMockResult,
} from "@/lib/actions/platform-whatsapp-mock";

// C-40a — the non-production WhatsApp mock screen. Compose an outbound
// message or inject an inbound one; the same services the real
// provider and webhook will use handle both.

type TenantOption = { id: string; name: string };
type MessageRow = {
  id: string;
  tenantName: string;
  direction: "outbound" | "inbound";
  provider: string;
  toPhone: string | null;
  fromPhone: string | null;
  body: string | null;
  status: string;
  category: string;
  costPaise: string;
  createdAt: string;
};

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

function ResultLine({ result }: { result: WhatsAppMockResult }) {
  if (result.ok) {
    return (
      <span role="status" className="text-[12px] text-ink-3">
        Done.
      </span>
    );
  }
  return result.error ? (
    <span role="alert" className="text-[12px] text-ink-2">
      {result.error}
    </span>
  ) : null;
}

export function WhatsAppMock({
  tenants,
  messages,
}: {
  tenants: TenantOption[];
  messages: MessageRow[];
}) {
  const [sendState, sendAction, sendPending] = useActionState(
    sendMockMessageAction,
    { ok: false, error: "" } as WhatsAppMockResult,
  );
  const [inboundState, inboundAction, inboundPending] = useActionState(
    injectInboundMessageAction,
    { ok: false, error: "" } as WhatsAppMockResult,
  );

  const tenantSelect = (name: string) => (
    <select name={name} required className={inputClass} defaultValue={tenants[0]?.id}>
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>
          {tenant.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <form
          action={sendAction}
          method="post"
          suppressHydrationWarning
          className="rounded-card bg-paper border border-line p-5 space-y-3"
        >
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Send (mock outbound)
          </h2>
          {tenantSelect("tenantId")}
          <input
            name="toPhone"
            required
            placeholder="+919800000001"
            className={inputClass}
          />
          <textarea
            name="body"
            required
            rows={3}
            placeholder="Message body"
            className={inputClass}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={sendPending || tenants.length === 0}
              className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
            >
              {sendPending ? "Sending…" : "Send mock message"}
            </button>
            <ResultLine result={sendState} />
          </div>
        </form>

        <form
          action={inboundAction}
          method="post"
          suppressHydrationWarning
          className="rounded-card bg-paper border border-line p-5 space-y-3"
        >
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Receive (simulate inbound)
          </h2>
          {tenantSelect("tenantId")}
          <input
            name="fromPhone"
            required
            placeholder="+919800000002"
            className={inputClass}
          />
          <textarea
            name="body"
            required
            rows={3}
            placeholder="What the parent wrote"
            className={inputClass}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={inboundPending || tenants.length === 0}
              className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
            >
              {inboundPending ? "Injecting…" : "Inject inbound"}
            </button>
            <ResultLine result={inboundState} />
          </div>
        </form>
      </div>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Message log (latest {messages.length})
        </h2>
        {messages.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
            Nothing logged yet. Send or inject a message above.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {messages.map((message) => (
              <div
                key={message.id}
                className="border-b border-line last:border-b-0 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-ink">
                    <span
                      className={`mr-2 rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                        message.direction === "outbound"
                          ? "bg-marine/10 text-marine"
                          : "bg-deck text-ink-2"
                      }`}
                    >
                      {message.direction}
                    </span>
                    {message.tenantName} ·{" "}
                    {message.direction === "outbound"
                      ? message.toPhone
                      : message.fromPhone}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {message.provider} · {message.status} ·{" "}
                    {message.costPaise} paise
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">{message.body}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  }).format(new Date(message.createdAt))}{" "}
                  IST
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
