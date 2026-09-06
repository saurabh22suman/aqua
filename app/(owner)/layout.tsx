import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { LayoutDashboard, Users, FileText, Settings } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-16">
      {children}
      <BottomNav
        active="/owner"
        items={[
          { href: "/owner", label: "Home", icon: LayoutDashboard },
          { href: "/owner/members", label: "Members", icon: Users },
          { href: "/owner/reports", label: "Reports", icon: FileText },
          { href: "/owner/settings", label: "Settings", icon: Settings },
        ]}
      />
    </div>
  );
}
