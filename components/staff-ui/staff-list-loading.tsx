import { Skeleton, SkeletonList, SkeletonStatus } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

export function StaffListLoading({ label, search = false }: { label: string; search?: boolean }) {
  return (
    <StaffPage className="max-w-xl">
      <SkeletonStatus>{label}</SkeletonStatus>
      <Skeleton w={32} h={6} />
      <Skeleton w={53} h={3} className="mt-2" />
      {search ? <Skeleton w="full" h={11} rounded="rounded-ctl" className="mt-5" /> : null}
      <SkeletonList className="mt-5" />
    </StaffPage>
  );
}
