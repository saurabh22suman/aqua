import { auth } from "@/lib/auth/server";

async function handle(request: Request): Promise<Response> {
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
