import type { NextRequest } from "next/server";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { getPaymentQrImage } from "@/lib/services/payment-qrs";

// C-35 — serve an uploaded payment-QR image. Session-gated and
// tenant-scoped: the context comes from the better-auth session, the
// permission gate is settings.read (reception holds it), and the
// service only returns rows of the caller's tenant. A missing or
// out-of-tenant QR is a 404 — same answer, no probing.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ qrId: string }> },
) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!hasPermission(ctx, "settings.read")) {
    return new Response("Not found", { status: 404 });
  }

  const { qrId } = await params;
  const image = await getPaymentQrImage(ctx, qrId);
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(image.data), {
    status: 200,
    headers: {
      "content-type": image.mime,
      "content-length": String(image.data.byteLength),
      "cache-control": "private, max-age=300",
    },
  });
}
