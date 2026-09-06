import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { CalendarDays, UserPlus, ClipboardList } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function ReceptionLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-16">
      {children}
      <BottomNav
        active="/reception"
        items={[
          { href: "/reception", label: "Today", icon: CalendarDays },
          { href: "/reception/members/new", label: "Add member", icon: UserPlus },
          { href: "/reception/enquiries", label: "Enquiries", icon: ClipboardList },
        ]}
      />
    </div>
  );
}