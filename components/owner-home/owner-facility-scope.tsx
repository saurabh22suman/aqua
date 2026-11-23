"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const FacilityControl = createContext<ReactNode>(null);

export function OwnerFacilityScopeProvider({
  control,
  children,
}: {
  control: ReactNode;
  children: ReactNode;
}) {
  return <FacilityControl.Provider value={control}>{children}</FacilityControl.Provider>;
}

export function OwnerStageScope() {
  const control = useContext(FacilityControl);
  return control ? <div className="floodlit-scope">{control}</div> : null;
}

export function OwnerHeaderFacilityScope() {
  const control = useContext(FacilityControl);
  const pathname = usePathname();
  return pathname === "/owner" ? null : control;
}
