import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { getScopedSelfReceiptInTx } from "@/lib/services/receipts";
import { isBillingDeadlock } from "@/lib/services/self-billing-errors";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
export function GET() { return new Response("Method not allowed", { status: 405, headers: { allow: "POST", "cache-control": "private, no-store" } }); }
function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase(); const raw = request.headers.get("origin");
  if (!host || !raw) return false;
  try { const origin = new URL(raw); return origin.origin.toLowerCase() === raw.toLowerCase() && origin.host.toLowerCase() === host && (process.env.NODE_ENV !== "production" || origin.protocol === "https:"); } catch { return false; }
}
export async function POST(request: Request, { params }: { params: Promise<{ memberId: string; paymentId: string }> }) {
  if (!originAllowed(request)) return missing();
  const { memberId, paymentId } = await params; if (!UUID.test(memberId) || !UUID.test(paymentId)) return missing();
  try {
    const resolver = await resolveScopedSelfScope("guardian"); if (!resolver) return missing();
    const result = await resolver.read((tx, scope) => getScopedSelfReceiptInTx(tx, scope, paymentId, memberId));
    if (!result.ok) return missing();
    return new Response(new Uint8Array(result.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${result.fileName}"`, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError) return missing();
    if (isBillingDeadlock(error)) return new Response("Please try again.", { status: 503, headers: { "cache-control": "private, no-store", "retry-after": "1" } });
    return new Response("Unable to provide the receipt.", { status: 500, headers: { "cache-control": "private, no-store" } });
  }
}
