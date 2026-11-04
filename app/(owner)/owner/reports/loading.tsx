import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Reports cold-load. Shape mirrors app/(owner)/owner/reports/page.tsx:
// page heading + period meta → two catalogue shortcuts → a 2×2 key
// report grid. No invented figures are shown while the reads settle.

export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={20} h={5} />
      <Skeleton w={56} h={4} className="mt-2" />

      <div className="mt-4 flex gap-2">
        <Skeleton w={28} h={12} />
        <Skeleton w={24} h={12} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {[0, 1, 2, 3].map((card) => (
          <div
            key={card}
            className="rounded-card bg-paper border border-line p-5"
          >
            <Skeleton w={28} h={4} className="mb-3" />
            <ul>
              {[0, 1, 2, 3, 4].map((row) => (
                <li
                  key={row}
                  className="flex items-center gap-4 border-b border-line py-2 last:border-0"
                >
                  <Skeleton w={28} h={4} />
                  <Skeleton w={12} h={4} className="ml-auto" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </OwnerPage>
  );
}
