import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { CalendarDays, Users, UserRound, ListChecks } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function CoachLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-16">
      {children}
      <BottomNav
        active="/coach"
        items={[
          { href: "/coach", label: "Today", icon: ListChecks },
          { href: "/coach/schedule", label: "Schedule", icon: CalendarDays },
          { href: "/coach/members", label: "Members", icon: Users },
          { href: "/coach/me", label: "Me", icon: UserRound },
        ]}
      />
    </div>
  );
}
