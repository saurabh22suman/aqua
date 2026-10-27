import { SportIllustration } from "@/components/illustrations/sport-illustration";
import { resolveSportKey } from "@/components/illustrations/resolve-sport";

// Owner Home — the small piece of club artwork beside the heading.
//
// The artwork is chosen from the club's OWN programme names (the ones
// the dashboard read already carries), never at random and never from
// a list the product does not have. When the programmes name a sport,
// that sport is drawn; when they do not, the neutral club mark is.
//
// The seed is the tenant and the day, so the picture is STABLE for the
// visit: a re-render, a hydration pass or a route change never swaps
// the art under the reader.
export function OwnerHomeIllustration({
  programNames,
  seed,
  size = 60,
}: {
  programNames: readonly string[];
  seed: string;
  size?: number;
}) {
  const sport = resolveSportKey({ programNames, seed });
  return (
    <div
      data-testid="owner-home-illustration"
      className="flex-none rounded-card bg-[var(--illustration-surface)] p-1.5"
    >
      <SportIllustration sport={sport} size={size} />
    </div>
  );
}
