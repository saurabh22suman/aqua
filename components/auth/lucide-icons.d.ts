// Type declarations for lucide's per-icon entry points.
//
// AGENTS.md asks for lucide icons to be imported from individual paths
// rather than the package barrel, so a route that shows five icons does
// not pull the whole set. lucide-react ships one declarations file for
// the barrel and none per icon, so the deep paths need this ambient
// declaration.
//
// It is type-only: `import type` is erased at compile time, so nothing
// here reaches the bundle, and the icon itself still comes from the
// package's own ESM file at runtime.
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";

  const icon: LucideIcon;
  export default icon;
}
