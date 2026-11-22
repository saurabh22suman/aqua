import type { NextRequest } from "next/server";
import { verifyParentLinkToken } from "@/lib/services/parent-link";
import { getReceiptForMember } from "@/lib/services/receipts";
import { asTenantId } from "@/lib/ids";

// PR2-C11 — token-scoped receipt download for the parent link. The
// token is the credential (same verifier as /p/[token]); the service
// scopes the lookup to the token's personId, so a forged or
// another-child payment id returns the same generic 404 as a missing
// one. No staff session is involved and the route leaks nothing.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; paymentId: string }> },
): Promise<Response> {
  const { token, paymentId } = await params;
  const claims = verifyParentLinkToken(token);
  if (!claims) return notFound();

  const result = await getReceiptForMember(
    asTenantId(claims.tenantId),
    claims.personId,
    paymentId,
  );
  if (!result.ok) return notFound();

  return new Response(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(result.pdf.byteLength),
      "content-disposition": `attachment; filename="${result.fileName}"`,
      // The receipt is the SAME signed credential as the parent page
      // (app/p/[token]/route.ts) and carries the same personal data —
      // a specific child's payment. The page already answers no-store
      // for that reason; the receipt used to answer
      // "private, max-age=300", which PERMITTED the browser to cache
      // the PDF for up to five minutes. One credential, one caching
      // policy.
      "cache-control": "private, no-store",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
