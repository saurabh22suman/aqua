"use server";

import { z } from "zod";
import { headers,cookies } from "next/headers";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { listClubChoices } from "@/db/club-selection";
import { ACTIVE_CLUB_COOKIE } from "@/lib/auth/active-club";
import { FACILITY_COOKIE } from "@/lib/facility";

export async function selectClubAction(raw: unknown): Promise<{ kind: "ok"; path: string } | { error: string }> {
  const input = z.object({ tenantId: z.string().uuid() }).safeParse(raw);
  if (!input.success) return { error: "Choose an available club." };
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return { error: "Sign in again to choose a club." };
  const choices = await listClubChoices(session.user.id,new Date(session.session.createdAt));
  const selected = choices.find(club => club.tenantId === input.data.tenantId);
  if (!selected) return { error: "This club is no longer available. Refresh and choose again." };
  const store = await cookies();
  store.set(ACTIVE_CLUB_COOKIE,selected.tenantId,{ httpOnly: true,secure: process.env.NODE_ENV === "production",
    sameSite: "lax",path: "/",maxAge: 30*24*60*60 });
  store.delete(FACILITY_COOKIE);
  return { kind: "ok", path: selected.homePath };
}
