import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SelfRouteFrame } from "../self-route";

export const metadata: Metadata = { title: { absolute: "Family view · Aqua" } };

export default function TaskLayout({ children }: { children: ReactNode }) {
  return <SelfRouteFrame>{children}</SelfRouteFrame>;
}
