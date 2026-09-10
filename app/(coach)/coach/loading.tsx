import { Skeleton } from "@/components/skeleton";

// Coach home cold-load. The page calls getCoachHomeAction (one DB
// read over the coach's batches, sessions and marking progress)
// plus a date lookup; without this file the user sees a blank
// document for the 2–7s cold-load window. Next.js streams this
// skeleton instead so the coach sees "Today" + a card-shaped list
// while the data resolves.
//
// Shape mirrors app/(coach)/coach/page.tsx: a "Today" display
// heading followed by 2 register-link cards (each a heading row
// + a lane strip bar).

export default function Loading() {
  return (
    <main className="px-5 pt-10 pb-8">
      {/* "Today" heading */}
      <Skeleton w={14} h={6} />

      {/* 2 register-link cards */}
      <ul className="mt-6 space-y-4">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="bg-paper rounded-card border border-line p-4"
          >
            <div className="flex justify-between items-baseline mb-2">
              <Skeleton w={40} h={4} />
              <Skeleton w={10} h={4} />
            </div>
            <Skeleton w={80} h={1.5} rounded="rounded-pill" />
          </li>
        ))}
      </ul>
    </main>
  );
}
