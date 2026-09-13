import { ParentLinkExplainer } from "@/components/parent-link-explainer";

// P-D3 (2026-09-13 UI/UX audit): a cross-surface role hitting /parent
// must get the same club-link explanation a parent would, not the
// global "we couldn't find that page" 404. Born from the page-level
// notFound() in page.tsx.
export default function ParentNotFound() {
  return <ParentLinkExplainer />;
}
