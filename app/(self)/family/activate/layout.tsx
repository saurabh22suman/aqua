import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { absolute: "Activation · Aqua" } };

export default function TaskLayout({ children }: { children: ReactNode }) {
  return children;
}
