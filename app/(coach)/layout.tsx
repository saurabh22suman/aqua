import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function CoachLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav
        items={[
          { href: "/coach", label: "Today", iconName: "list-checks" },
          { href: "/coach/schedule", label: "Schedule", iconName: "calendar-days" },
          { href: "/coach/members", label: "Members", iconName: "users" },
          { href: "/coach/me", label: "Me", iconName: "user-round" },
        ]}
      />
    </div>
  );
}
