import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { absolute: "Announcements · Aqua" } };

export default function TaskLayout({ children }: { children: ReactNode }) {
  return children;
}
