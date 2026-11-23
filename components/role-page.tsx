import type { ReactNode } from "react";

// The staff surfaces' shared frame.
//
// Historically this file carried its own main element; the approved
// staff composition now lives in `components/staff-ui/staff-page.tsx`
// so coach, reception and worker cannot drift. `RolePage` remains as a
// thin alias for existing role consumers — it carries no data, adds no
// capability and changes no action.
export { StaffPage as RolePage } from "@/components/staff-ui/staff-page";

export type RolePageProps = {
  children: ReactNode;
};
