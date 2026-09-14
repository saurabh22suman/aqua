import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { messageLog } from "@/db/schema/message-log";
import {
  MESSAGE_COST_PAISE,
  getMessageProvider,
  type MessageCategory,
  type MessageProvider,
} from "./provider";
import type { TenantId } from "@/lib/ids";

// C-40a — the send path. The provider call happens outside the
// transaction (network), then the metered row is written; a failed
// provider call writes a failed row rather than throwing away the
// attempt. Every send records an estimated cost from the first row.

const sendInputSchema = z.object({
  toPhone: z.string().trim().min(5).max(40),
  body: z.string().trim().min(1).max(4096),
  templateKey: z.string().trim().max(120).optional(),
  category: z
    .enum(["utility", "marketing", "service", "authentication"])
    .default("utility"),
});

export type SendMessageResult =
  | { ok: true; messageId: string; providerMessageId: string }
  | { ok: false; error: string };

export async function sendMessage(input: {
  tenantId: TenantId;
  toPhone: string;
  body: string;
  templateKey?: string;
  category?: MessageCategory;
  // undefined = resolve from env; null = explicitly no provider
  // (the fail-closed path tests/ops surfaces use).
  provider?: MessageProvider | null;
}): Promise<SendMessageResult> {
  const parsed = sendInputSchema.safeParse({
    toPhone: input.toPhone,
    body: input.body,
    templateKey: input.templateKey,
    category: input.category ?? "utility",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid message.",
    };
  }

  const provider =
    input.provider === undefined ? getMessageProvider() : input.provider;
  if (!provider) {
    return {
      ok: false,
      error: "No messaging provider is configured. Nothing was sent.",
    };
  }

  const costPaise = MESSAGE_COST_PAISE[parsed.data.category];

  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  let error: string | null = null;
  try {
    const result = await provider.send({
      tenantId: input.tenantId,
      toPhone: parsed.data.toPhone,
      body: parsed.data.body,
      ...(parsed.data.templateKey ? { templateKey: parsed.data.templateKey } : {}),
      category: parsed.data.category,
    });
    providerMessageId = result.providerMessageId;
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : "Provider send failed.";
  }

  const messageId = await withTenant(input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(messageLog)
      .values({
        tenantId: input.tenantId,
        direction: "outbound",
        provider: provider.name,
        providerMessageId,
        toPhone: parsed.data.toPhone,
        templateKey: parsed.data.templateKey ?? null,
        body: parsed.data.body,
        status,
        error,
        category: parsed.data.category,
        costPaise: status === "sent" ? costPaise : 0n,
      })
      .returning({ id: messageLog.id });
    if (!row) throw new Error("sendMessage: message_log insert returned no row");
    return row.id;
  });

  if (status === "failed") {
    return { ok: false, error: error ?? "Provider send failed." };
  }
  return {
    ok: true,
    messageId,
    providerMessageId: providerMessageId ?? "",
  };
}
