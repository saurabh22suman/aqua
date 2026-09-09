import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { sessionExists } from "@/lib/auth/context";

export default async function ReceptionLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return (
    <div className="min-h-dvh pb-16">
      {children}
      <BottomNav
        items={[
          { href: "/reception", label: "Today", iconName: "calendar-days" },
          { href: "/reception/members/new", label: "Add member", iconName: "user-plus" },
          { href: "/reception/enquiries", label: "Enquiries", iconName: "clipboard-list" },
          // K2 — fourth tab matches the design's 4-item bottom bar
          // (DESIGN.md §2). The sign-out form lives at /reception/me.
          { href: "/reception/me", label: "Me", iconName: "user-round" },
        ]}
      />
    </div>
  );
}