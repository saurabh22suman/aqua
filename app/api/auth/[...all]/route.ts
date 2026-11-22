import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";

async function handle(request: Request): Promise<Response> {
  // Only session reads and sign-out belong on the public generic auth surface.
  // Credential changes must use our PIN-policy and authorization boundaries.
  // Internal auth.api calls remain available to those scoped services.
  const path = new URL(request.url).pathname;
  if (!((request.method === "GET" && path === "/api/auth/get-session") ||
    (request.method === "POST" && path === "/api/auth/sign-out"))) {
    return Response.json({ error: "Use the Aqua sign-in or PIN recovery page." }, { status: 404 });
  }
  // better-auth does not propagate ALS; this wrap is load-bearing, do not remove
  return withPlatform(() => auth.handler(request));
}

export const GET = handle;
export const POST = handle;
