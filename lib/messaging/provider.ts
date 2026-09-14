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

export type MessageProviderName = "mock" | "cloud" | "disabled";

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
};

export function resolveProviderName(config: ProviderConfig = {}): MessageProviderName {
  const provider = config.provider ?? env.WHATSAPP_PROVIDER;
  const nodeEnv = config.nodeEnv ?? env.NODE_ENV;
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
  return resolveProviderName(config) === "mock";
}

export type OutboundMessage = {
  tenantId: TenantId;
  toPhone: string;
  body: string;
  templateKey?: string;
  category: MessageCategory;
};

export type SendResult = {
  providerMessageId: string;
  status: "sent";
};

export interface MessageProvider {
  readonly name: "mock" | "cloud";
  send(message: OutboundMessage): Promise<SendResult>;
}

export function getMessageProvider(
  config: ProviderConfig = {},
): MessageProvider | null {
  const name = resolveProviderName(config);
  if (name === "mock") return createMockProvider();
  // "cloud" arrives with C-40 (WhatsApp Cloud API adapter); until then
  // there is no provider, so sends fail loudly rather than silently.
  return null;
}
