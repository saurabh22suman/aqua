import { Skeleton } from "@/components/skeleton";

// Owner home cold-load. The real page is a Promise.all over three
// actions (dashboard / branding / terminology) and takes 2–7s on a
// cold dev compile per the audit. Without this file the user sees
// a blank document for that whole window — no header, no hero,
// nothing. With it, Next.js streams this skeleton immediately while
// the page's data fetches resolve.
//
// Shape mirrors components/owner-dashboard.tsx:
//   header (mark + name)  →  hero card (3.5rem tall)  →  3 stat chips
//   (3.5rem)  →  "Needs you today" section (4 rows)  →  "Today's
//   facilities" section (2 lane rows). Heights match the real
//   font sizes from DESIGN.md §1.3 (h=N means N*4px).

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      {/* Header row: tenant mark + display name + day label */}
      <div className="flex items-center gap-3 pb-4">
        <Skeleton w={11} h={11} rounded="rounded-full" />
        <div>
          <Skeleton w={32} h={5} className="mb-1.5" />
          <Skeleton w={20} h={3} />
        </div>
      </div>

      {/* Hero card (3.5rem tall — matches the marine block on the live page) */}
      <Skeleton w={80} h={14} rounded="rounded-card" />

      {/* 3 stat chips (3.5rem tall) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Skeleton w={28} h={14} rounded="rounded-ctl" />
        <Skeleton w={28} h={14} rounded="rounded-ctl" />
        <Skeleton w={28} h={14} rounded="rounded-ctl" />
      </div>

      {/* "Needs you today" heading + 4 attention rows */}
      <Skeleton w={36} h={4} className="mt-7 mb-2.5" />
      <ul>
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 border border-line rounded-ctl px-3.5 py-3 mb-2"
          >
            <Skeleton w={9} h={9} rounded="rounded-[11px]" />
            <div className="min-w-0 flex-1">
              <Skeleton w={48} h={4} className="mb-1.5" />
              <Skeleton w={32} h={3} />
            </div>
          </li>
        ))}
      </ul>

      {/* "Today's facilities" heading + 2 lane strip rows */}
      <Skeleton w={40} h={4} className="mt-7 mb-2.5" />
      <ul>
        {[0, 1].map((i) => (
          <li
            key={i}
            className="rounded-card border border-line px-4 py-3.5 mb-2.5"
          >
            <div className="flex justify-between items-baseline mb-2">
              <Skeleton w={32} h={4} />
              <Skeleton w={10} h={4} />
            </div>
            <Skeleton w={64} h={1.5} rounded="rounded-pill" />
          </li>
        ))}
      </ul>
    </main>
  );
}
