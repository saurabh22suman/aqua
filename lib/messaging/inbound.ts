import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { messageLog } from "@/db/schema/message-log";
import type { TenantId } from "@/lib/ids";

// C-40a — the inbound path. The real WhatsApp webhook (C-37 is gone as
// a PSP task; the messaging webhook arrives with the Cloud adapter)
// will resolve the tenant from the phone_number_id and call this. The
// mock screen injects payloads through exactly this function, so
// inbound flows can be built and tested today.

const inboundSchema = z.object({
  fromPhone: z.string().trim().min(5).max(40),
  toPhone: z.string().trim().max(40).optional(),
  body: z.string().trim().min(1).max(4096),
  providerMessageId: z.string().trim().max(200).optional(),
  provider: z.enum(["mock", "cloud"]).default("mock"),
});

export type InboundMessageInput = z.input<typeof inboundSchema> & {
  tenantId: TenantId;
};

export type InboundMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export async function handleInboundMessage(
  input: InboundMessageInput,
): Promise<InboundMessageResult> {
  const parsed = inboundSchema.safeParse({
    fromPhone: input.fromPhone,
    toPhone: input.toPhone,
    body: input.body,
    providerMessageId: input.providerMessageId,
    provider: input.provider ?? "mock",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid inbound message.",
    };
  }

  const messageId = await withTenant(input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(messageLog)
      .values({
        tenantId: input.tenantId,
        direction: "inbound",
        provider: parsed.data.provider,
        providerMessageId: parsed.data.providerMessageId ?? null,
        fromPhone: parsed.data.fromPhone,
        toPhone: parsed.data.toPhone ?? null,
        body: parsed.data.body,
        status: "received",
        category: "service",
        costPaise: 0n,
      })
      .returning({ id: messageLog.id });
    if (!row) {
      throw new Error("handleInboundMessage: insert returned no row");
    }
    return row.id;
  });

  return { ok: true, messageId };
}
