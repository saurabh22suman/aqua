import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav
        items={[
          { href: "/owner", label: "Home", iconName: "layout-dashboard" },
          { href: "/owner/members", label: "Members", iconName: "users" },
          { href: "/owner/reports", label: "Reports", iconName: "file-text" },
          { href: "/owner/settings", label: "Settings", iconName: "settings" },
        ]}
      />
    </div>
  );
}
