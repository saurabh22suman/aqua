import type { LucideIcon } from "lucide-react";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
import Building2 from "lucide-react/dist/esm/icons/building-2.mjs";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard.mjs";
import ListChecks from "lucide-react/dist/esm/icons/list-checks.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import type { OpsIconName } from "./ops-nav-items";

// Ops redesign (28 October 2026) — the Ops icon registry.
//
// The tenant surfaces share components/bottom-nav.tsx's registry, but
// that file is not this lane's to change and it carries no message or
// activity icon. Ops therefore keeps its own small registry, with the
// icons imported from their individual paths (the house rule: never
// the lucide barrel, which pulls the whole set into the bundle).
//
// The icons are decorative: every navigation row also carries its
// text label, so the icon is never the only carrier of the meaning.

export const OPS_ICONS: Record<OpsIconName, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "building-2": Building2,
  "clipboard-list": ClipboardList,
  "list-checks": ListChecks,
  "sliders-horizontal": SlidersHorizontal,
  "message-circle": MessageCircle,
  activity: Activity,
};
