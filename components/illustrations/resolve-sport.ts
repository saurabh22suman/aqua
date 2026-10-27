// Owner Lavender B — choosing the small sport artwork.
//
// The human approved a small piece of sport artwork beside the daily
// Owner header. The artwork has to be HONEST about the club it
// represents, and the product has to be honest about what it knows.
//
// What the data model gives us: the club's own PROGRAMME names (the
// dashboard read already carries today's programme names and the next
// class's programme). It does NOT give us a list of "the sports this
// tenant is permitted to offer" — a multi-sport tenant's catalogue is
// operator-entered free text, and the tenant preset key is not part
// of any owner-surface read.
//
// So the rule is:
//
//   * a specific context (a page or a card that IS about one sport)
//     wins outright;
//   * otherwise the club's own programme names decide — a club whose
//     programmes are named "Swimming …" and "Football …" runs those
//     sports, and one that names neither gets the NEUTRAL club mark
//     rather than a guess;
//   * when several sports are named, the pick is derived from a seed
//     the caller supplies (the tenant and the day), so it is STABLE
//     for the visit and never re-randomised on a re-render, a
//     hydration pass or a route change.
//
// When a real "permitted sports" list is added to the tenant model,
// this module is the single place that has to learn about it: give it
// the permitted list and it will pick from those and nothing else.

export type SportKey = "swimming" | "badminton" | "football" | "club";

export type SportResolution = {
  /** The club's own programme names, as the dashboard read reports them. */
  programNames?: readonly string[];
  /** A specific context that wins over the programme names. */
  context?: SportKey | null;
  /** A stable seed for the visit (tenant + day). Same seed, same art. */
  seed?: string;
};

// The vocabulary is deliberately small and specific. A programme name
// only counts when it names a sport the product actually draws; an
// unrelated word never matches.
const SPORT_VOCABULARY: { key: SportKey; patterns: RegExp[] }[] = [
  { key: "swimming", patterns: [/\bswim\w*/i, /\baquatic\w*/i] },
  { key: "badminton", patterns: [/\bbadminton\w*/i, /\bshuttlecock\w*/i] },
  { key: "football", patterns: [/\bfootball\w*/i, /\bsoccer\w*/i] },
];

/** The sports a club's own programme names actually mention, in order. */
export function sportsNamedBy(programNames: readonly string[]): SportKey[] {
  const named: SportKey[] = [];
  for (const entry of SPORT_VOCABULARY) {
    if (
      programNames.some((name) =>
        entry.patterns.some((pattern) => pattern.test(name)),
      )
    ) {
      named.push(entry.key);
    }
  }
  return named;
}

/**
 * The artwork for this visit.
 *
 * Deterministic: the same input always produces the same sport, on the
 * server and on the client, so the art never swaps under the reader.
 */
export function resolveSportKey(input: SportResolution): SportKey {
  // A specific context wins outright — including the explicit neutral
  // mark, which a caller uses when it knows better than the names do.
  if (input.context) return input.context;
  const named = sportsNamedBy(input.programNames ?? []);
  if (named.length === 0) return "club";
  if (named.length === 1) return named[0]!;
  return named[stableIndex(input.seed ?? "", named.length)]!;
}

/**
 * A stable index for a seed (FNV-1a). The same seed always lands on
 * the same sport, so the picture is chosen once per visit rather than
 * per render.
 */
function stableIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}
