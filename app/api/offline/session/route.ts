import { NextResponse } from "next/server";
import { z } from "zod";
import { offlineSessionState } from "@/lib/offline/server-session";

export async function GET(request: Request) {
  const input = z.object({}).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const state = await offlineSessionState();
  return NextResponse.json(state, { headers: { "Cache-Control": "private, no-store" } });
}
