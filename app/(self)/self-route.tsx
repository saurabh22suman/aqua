import type { ReactNode } from "react";
import { Skeleton, SkeletonList, SkeletonStatus } from "@/components/skeleton";
import "./self-route.css";

export function SelfRouteFrame({ children }: { children: ReactNode }) {
  return <div className="self-route">{children}</div>;
}

export function SelfScreenLoading({ label, variant = "home" }: {
  label: string;
  variant?: "home" | "notices" | "billing" | "account" | "progress";
}) {
  const isHome = variant === "home";
  return (
    <main className="self-page" data-self-loading={variant}>
      <SkeletonStatus>{label}</SkeletonStatus>
      <div aria-hidden="true" className="self-toprow">
        <div className="flex items-center gap-2.5">
          <Skeleton w={8} h={8} rounded="rounded-xl" className="shrink-0" />
          <div className="min-w-0">
            <Skeleton w={31} h={3.5} />
            <Skeleton w={18} h={3} className="mt-1.5" />
          </div>
        </div>
      </div>
      <div className="self-main">
        {isHome ? (
          <>
            <Skeleton w="full" h={27} rounded="rounded-card" />
            <Skeleton w="full" h={11} rounded="rounded-ctl" />
          </>
        ) : (
          <div className="space-y-2">
            <Skeleton w={37} h={6} />
            <Skeleton w={49} h={3} />
          </div>
        )}
        {variant === "billing" || variant === "account" || variant === "progress" ? (
          <div className="self-card space-y-3 p-4">
            <Skeleton w={28} h={4} />
            <Skeleton w={40} h={5} />
            <Skeleton w={32} h={3} />
          </div>
        ) : null}
        <SkeletonList />
      </div>
    </main>
  );
}
