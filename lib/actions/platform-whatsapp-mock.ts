"use server";

import { z } from "zod";
import { opsAction } from "@/db/ops-action";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { createMockProvider } from "@/lib/messaging/mock-provider";
import { sendMessage } from "@/lib/messaging/send";
import { handleInboundMessage } from "@/lib/messaging/inbound";
import { asUserId } from "@/lib/ids";

// C-40a — the non-production WhatsApp mock's actions: compose an
// outbound message and inject an inbound one. Both go through the same
// services the real provider/webhook will use, so what is exercised
// here is the production code path with a fake transport.
//
// The screen and these actions refuse to operate in production (the
// env boot guard already refuses WHATSAPP_PROVIDER=mock there; this is
// the request-time layer).

const sendFormInput = z.object({
  tenantId: z.string().uuid(),
  toPhone: z.string().trim().min(5).max(40),
  body: z.string().trim().min(1).max(4096),
});

const inboundFormInput = z.object({
  tenantId: z.string().uuid(),
  fromPhone: z.string().trim().min(5).max(40),
  body: z.string().trim().min(1).max(4096),
});

export type WhatsAppMockResult =
  | { ok: true }
  | { ok: false; error: string };

function mockGuard(): string | null {
  try {
    return mockMessagingEnabled()
      ? null
      : "The WhatsApp mock is only available outside production.";
  } catch {
    return "The WhatsApp mock is not available here.";
  }
}

export async function sendMockMessageAction(
  _prev: unknown,
  formData: FormData,
): Promise<WhatsAppMockResult> {
  const surface = sendFormInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    toPhone: String(formData.get("toPhone") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim(),
  });
  if (!surface.success) {
    return {
      ok: false,
      error: surface.error.issues[0]?.message ?? "Invalid message.",
    };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }
  const guard = mockGuard();
  if (guard) return { ok: false, error: guard };

  const result = await opsAction(
    {
      scope: "message.send",
      actorId: asUserId(status.userId),
      tenantId: surface.data.tenantId,
      targetType: "message",
      detail: { toPhone: surface.data.toPhone, mock: true },
    },
    () =>
      sendMessage({
        tenantId: surface.data.tenantId as never,
        toPhone: surface.data.toPhone,
        body: surface.data.body,
        provider: createMockProvider(),
      }),
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function injectInboundMessageAction(
  _prev: unknown,
  formData: FormData,
): Promise<WhatsAppMockResult> {
  const surface = inboundFormInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    fromPhone: String(formData.get("fromPhone") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim(),
  });
  if (!surface.success) {
    return {
      ok: false,
      error: surface.error.issues[0]?.message ?? "Invalid inbound message.",
    };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }
  const guard = mockGuard();
  if (guard) return { ok: false, error: guard };

  const result = await opsAction(
    {
      scope: "message.inbound",
      actorId: asUserId(status.userId),
      tenantId: surface.data.tenantId,
      targetType: "message",
      detail: { fromPhone: surface.data.fromPhone, mock: true },
    },
    () =>
      handleInboundMessage({
        tenantId: surface.data.tenantId as never,
        fromPhone: surface.data.fromPhone,
        body: surface.data.body,
      }),
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
