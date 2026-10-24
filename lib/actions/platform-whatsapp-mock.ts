"use server";

import { z } from "zod";
import { opsAction } from "@/db/ops-action";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { sendMessage } from "@/lib/messaging/send";
import { handleInboundMessage } from "@/lib/messaging/inbound";
import { asUserId } from "@/lib/ids";

// C-40a — the WhatsApp mock console's actions: compose an outbound
// message and inject an inbound one. Both go through the same
// services the real provider/webhook will use, so what is exercised
// here is the production code path with a fake transport.
//
// The outbound action uses the CONFIGURED provider — the same one
// every other WhatsApp path in the app uses (tenant notifications,
// the platform sign-in code, the PIN-reset code). It used to pass a
// bare in-process mock instead, which posts to WHATSAPP_MOCK_URL: the
// local loopback viewer. In a deployment that variable is unset (it
// is validated as a loopback origin), so the action recorded
// "sent" and delivered NOTHING — the operator saw a success and the
// mock stayed empty. The configured provider is the hosted mock
// (WHATSAPP_CAPTURE_URL), which is where the message must land.
//
// The inbound injection is a database write (a message arriving FROM
// WhatsApp); it has no transport and no provider.

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

  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    return {
      ok: false,
      error:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
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
        // No provider override: sendMessage resolves the CONFIGURED
        // provider, which is the hosted mock in a deployment and the
        // in-process mock in local development.
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

  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    return {
      ok: false,
      error:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
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
