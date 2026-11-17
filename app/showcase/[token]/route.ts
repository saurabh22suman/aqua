import { resolvePublicShowcase } from "@/lib/services/showcase/publication";
import {
  renderShowcaseNotFound,
  renderShowcasePage,
} from "@/lib/services/showcase/public-page";

export const dynamic = "force-dynamic";

function pageHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Cache-Control": "no-store",
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const view = await resolvePublicShowcase(token);
  if (!view) {
    return new Response(renderShowcaseNotFound(), {
      status: 404,
      headers: pageHeaders(),
    });
  }
  return new Response(renderShowcasePage(view), {
    status: 200,
    headers: pageHeaders(),
  });
}
