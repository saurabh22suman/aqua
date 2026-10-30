"use client";

import { useActionState } from "react";
import {
  injectInboundMessageAction,
  sendMockMessageAction,
  type WhatsAppMockResult,
} from "@/lib/actions/platform-whatsapp-mock";
import { Button } from "@/components/ui/Button";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  OpsCard,
  OpsCardFlush,
  OpsEmptyState,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";

// C-40a — the non-production WhatsApp mock screen. Compose an outbound
// message or inject an inbound one; the same services the real
// provider and webhook will use handle both.
//
// Ops redesign (28 October 2026): every control is the SHARED control,
// the cards are the shared Ops frame, and the message log shows the
// data the platform actually holds — including the cost the mock
// metered, which is a real figure, not a decoration.

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

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const STATUS_TONE: Record<string, StatusTone> = {
  received: "good",
  sent: "water",
  failed: "late",
  queued: "neutral",
} as const;

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
    <Select name={name} required defaultValue={tenants[0]?.id}>
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>
          {tenant.name}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <OpsCard className="space-y-3 p-5">
          <form
            action={sendAction}
            method="post"
            suppressHydrationWarning
            className="space-y-3"
          >
            <h2 className="font-display text-[16px] font-semibold text-ink">
              Send (mock outbound)
            </h2>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Tenant
              </span>
              {tenantSelect("tenantId")}
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                To phone
              </span>
              <Input name="toPhone" required placeholder="+919800000001" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Body
              </span>
              <Textarea name="body" required rows={3} placeholder="Message body" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={sendPending || tenants.length === 0}
              >
                {sendPending ? "Sending…" : "Send mock message"}
              </Button>
              <ResultLine result={sendState} />
            </div>
          </form>
        </OpsCard>

        <OpsCard className="space-y-3 p-5">
          <form
            action={inboundAction}
            method="post"
            suppressHydrationWarning
            className="space-y-3"
          >
            <h2 className="font-display text-[16px] font-semibold text-ink">
              Receive (simulate inbound)
            </h2>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Tenant
              </span>
              {tenantSelect("tenantId")}
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                From phone
              </span>
              <Input name="fromPhone" required placeholder="+919800000002" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Body
              </span>
              <Textarea
                name="body"
                required
                rows={3}
                placeholder="What the parent wrote"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={inboundPending || tenants.length === 0}
              >
                {inboundPending ? "Injecting…" : "Inject inbound"}
              </Button>
              <ResultLine result={inboundState} />
            </div>
          </form>
        </OpsCard>
      </div>

      <OpsSection title={`Message log (latest ${messages.length})`}>
        {messages.length === 0 ? (
          <OpsEmptyState
            title="Nothing logged yet"
            body="Send or inject a message above — everything the mock handles is logged and metered like a real message."
          />
        ) : (
          <OpsCardFlush>
            {messages.map((message) => (
              <div
                key={message.id}
                className="border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-ink">
                    <OpsStatusPill
                      tone={
                        message.direction === "outbound" ? "water" : "neutral"
                      }
                      className="mr-2"
                    >
                      {message.direction}
                    </OpsStatusPill>
                    {message.tenantName} ·{" "}
                    {message.direction === "outbound"
                      ? message.toPhone
                      : message.fromPhone}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-ink-3">
                    <OpsStatusPill tone={STATUS_TONE[message.status] ?? "neutral"}>
                      {message.status}
                    </OpsStatusPill>
                    {message.provider} · {message.costPaise} paise
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">{message.body}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {DATE_FMT.format(new Date(message.createdAt))} IST
                </p>
              </div>
            ))}
          </OpsCardFlush>
        )}
      </OpsSection>
    </div>
  );
}
