import { env } from "@/lib/env";
import { createMockProvider } from "./mock-provider";
import type { TenantId } from "@/lib/ids";

// C-40a (payment/messaging decision, 2026-09-14) — provider selection
// and cost estimation.
//
// `WHATSAPP_PROVIDER` is optional at parse time. Outside production the
// default is the mock; in production the default is `disabled`, and the
// env boot guard refuses `mock` outright. So a production deployment
// can never silently pretend to deliver: either a real provider is
// configured or sends fail loudly (C-40 adds the Cloud API adapter).

export type MessageProviderName = "mock" | "capture" | "cloud" | "disabled";

export type MessageCategory =
  | "utility"
  | "marketing"
  | "service"
  | "authentication";

// Estimated landed cost per message, in paise. Authentication/utility
// list at roughly ₹0.115 (11.5 paise) — rounded to 12 here because the
// ledger is integer paise; marketing templates run ~7.5×, so 90.
// Estimates, recorded from the first row so metering exists before the
// real bill does.
export const MESSAGE_COST_PAISE: Record<MessageCategory, bigint> = {
  utility: 12n,
  authentication: 12n,
  marketing: 90n,
  service: 0n,
};

export type ProviderConfig = {
  provider?: MessageProviderName;
  nodeEnv?: "development" | "test" | "production";
  deploymentStage?: "development" | "preview" | "production";
};

export function resolveProviderName(config: ProviderConfig = {}): MessageProviderName {
  const provider = config.provider ?? env.WHATSAPP_PROVIDER;
  const nodeEnv = config.nodeEnv ?? env.NODE_ENV;
  if (provider === "capture" && (config.deploymentStage ?? env.AQUA_DEPLOYMENT_STAGE) !== "preview") {
    throw new Error("Hosted WhatsApp capture is allowed only in an explicit synthetic preview.");
  }
  if (provider === "mock" && nodeEnv === "production") {
    // lib/env.ts refuses this at boot; this is the second layer for any
    // caller that bypassed env parsing (tests, scripts).
    throw new Error(
      "Refusing to use the mock WhatsApp provider in production.",
    );
  }
  if (provider) return provider;
  return nodeEnv === "production" ? "disabled" : "mock";
}

export function mockMessagingEnabled(config: ProviderConfig = {}): boolean {
  return ["mock", "capture"].includes(resolveProviderName(config));
}

export type OutboundMessage = {
  // Platform authentication has no tenant. Tenant messages still carry one.
  tenantId?: TenantId;
  toPhone: string;
  body: string;
  templateKey?: string;
  category: MessageCategory;
};

export type SendResult = {
  providerMessageId: string;
  status: "sent";
};

// F08 (composed, rev 3) — a provider error that states the message was
// DEFINITELY not accepted (a validation rejection, a malformed recipient,
// a disabled account). Only this error makes a failed send safe to retry.
//
// Every OTHER failure — a timeout, a dropped connection, a 5xx — leaves
// the outcome UNKNOWN: the transport may have accepted the message before
// the failure surfaced. The dispatch records those as "unknown" and never
// retries them automatically.
//
// Note: no transport's idempotency support was researched or verified in
// this slice. If the provider that is eventually configured offers an
// idempotency key, it should be used as the primary defence against a
// duplicate and this taxonomy becomes a backstop.
export class MessageNotAcceptedError extends Error {
  readonly definitelyNotSent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "MessageNotAcceptedError";
  }
}

export interface MessageProvider {
  readonly name: "mock" | "cloud";
  send(message: OutboundMessage): Promise<SendResult>;
}

export function getMessageProvider(
  config: ProviderConfig = {},
): MessageProvider | null {
  const name = resolveProviderName(config);
  if (name === "mock") return createMockProvider();
  if (name === "capture") {
    if (!env.WHATSAPP_CAPTURE_URL) throw new Error("Hosted WhatsApp capture URL is not configured.");
    return createMockProvider({ url: env.WHATSAPP_CAPTURE_URL,
      headers: env.WHATSAPP_CAPTURE_AUTH_VALUE
        ? { [env.WHATSAPP_CAPTURE_AUTH_HEADER ?? "authorization"]: env.WHATSAPP_CAPTURE_AUTH_VALUE } : undefined });
  }
  // "cloud" arrives with C-40 (WhatsApp Cloud API adapter); until then
  // there is no provider, so sends fail loudly rather than silently.
  return null;
}
