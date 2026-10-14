import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { env } from "@/lib/env";
import type { MessageProvider, SendResult } from "./provider";

// C-40a — in-process by default; optionally captures sends in a local
// WhatsApp viewer. Both modes remain mock transport, never real delivery.
const captureResponse = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

export function createMockProvider(config: {
  url?: string;
  fromPhone?: string;
  headers?: Record<string, string>;
} = {}): MessageProvider {
  const url = config.url ?? env.WHATSAPP_MOCK_URL;
  const fromPhone = config.fromPhone ?? env.WHATSAPP_MOCK_FROM ?? "919000000000";
  return {
    name: "mock",
    async send(message): Promise<SendResult> {
      if (url) {
        const response = await fetch(
          new URL(`/v23.0/${fromPhone.replace(/^\+/, "")}/messages`, url),
          {
            method: "POST",
            headers: { ...config.headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: message.toPhone.replace(/^\+/, ""),
              type: "text",
              text: { body: message.body },
            }),
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        if (!response.ok) {
          throw new Error(`WhatsApp capture mock returned HTTP ${response.status}.`);
        }
        const result = captureResponse.parse(await response.json());
        return { providerMessageId: result.messages[0]!.id, status: "sent" };
      }
      return {
        providerMessageId: `mock-${uuidv7()}`,
        status: "sent",
      };
    },
  };
}
