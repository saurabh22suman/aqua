import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { absolute: "Sign in · Aqua" } };

export default function TaskLayout({ children }: { children: ReactNode }) {
  return children;
}
