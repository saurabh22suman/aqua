import { z } from "zod";

export const ACTIVE_CLUB_COOKIE = "aqua_active_club";
// A selection is only a hint. The database revalidates membership, role and
// club availability before it can become a request's authority.
export function activeClubFromHeaders(headers: Pick<Headers, "get">): string | undefined {
  const entry = headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${ACTIVE_CLUB_COOKIE}=`));
  if (!entry) return undefined;
  const raw = entry.slice(ACTIVE_CLUB_COOKIE.length + 1);
  const parsed = z.string().uuid().safeParse(raw);
  // An invalid selection must not silently switch authority to another club.
  return parsed.success ? parsed.data : "invalid";
}
export class ClubSelectionRequired extends Error {}
