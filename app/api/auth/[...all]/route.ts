import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";

async function handle(request: Request): Promise<Response> {
  return withPlatform(() => auth.handler(request));
}

export const GET = handle;
export const POST = handle;
