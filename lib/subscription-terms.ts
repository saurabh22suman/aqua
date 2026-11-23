import { addDays } from "@/lib/time/tz";

/** Default inclusive validity for a class pack; shared with the write path. */
export const SESSION_PACK_VALIDITY_DAYS = 90;

export function resolveSubscriptionEndDate(input: {
  kind: "duration" | "term" | "sessions";
  startsOn: string;
  durationDays: number | null;
  endsOn?: string;
}): string {
  if (input.endsOn) return input.endsOn;
  const days = input.kind === "sessions" ? SESSION_PACK_VALIDITY_DAYS : (input.durationDays ?? 30);
  return addDays(input.startsOn, days - 1);
}
