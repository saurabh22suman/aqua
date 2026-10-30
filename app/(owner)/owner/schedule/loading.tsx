import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton } from "@/components/skeleton";

// U-04 — schedule grid cold-load: heading, view controls, the week
// surface.
export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={32} h={6} />
      <Skeleton w={72} h={3} className="mt-3" />

      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton w={18} h={11} className="rounded-ctl" />
        <Skeleton w={14} h={11} className="rounded-ctl" />
        <Skeleton w={18} h={11} className="rounded-ctl" />
      </div>

      <div className="mt-4 rounded-card border border-line bg-paper p-5">
        <Skeleton w={56} h={4} />
        <div className="mt-4 grid grid-cols-7 gap-2">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <div key={day}>
              <Skeleton w={12} h={3} />
              <Skeleton w={20} h={40} className="mt-2 rounded" />
            </div>
          ))}
        </div>
      </div>
    </OwnerPage>
  );
}
