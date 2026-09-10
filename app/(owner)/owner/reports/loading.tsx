import { Skeleton } from "@/components/skeleton";

// Reports cold-load. The page is a Promise.all over four actions
// (attendance / enquiry funnel / retention / coach load) plus a
// timezone read; on a cold dev compile that's the worst surface on
// the owner side. Without this file the user sees a blank document
// for the full window — Next.js streams this instead so the layout
// reads as a reports screen the moment the route resolves.
//
// Shape mirrors app/(owner)/owner/reports/page.tsx: page heading +
// period meta  →  4 cards stacked (AttendanceReportCard /
// EnquiryFunnelCard / RetentionCard / CoachLoadCard), each card a
// heading line plus 8 skeleton rows.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      {/* Page heading */}
      <Skeleton w={20} h={5} />
      {/* Period meta line */}
      <Skeleton w={56} h={4} className="mt-2" />

      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((c) => (
          <div
            key={c}
            className="rounded-card bg-paper border border-line px-5 py-5"
          >
            {/* Card heading line */}
            <Skeleton w={28} h={4} className="mb-3" />
            {/* 8 skeleton rows */}
            <ul>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
                <li key={r} className="flex items-center gap-4 py-2 border-b border-line last:border-0">
                  <Skeleton w={28} h={4} />
                  <Skeleton w={12} h={4} />
                  <Skeleton w={12} h={4} className="ml-auto" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
