import { cn } from "@/components/ui/cn";

export function OwnerSectionLinks({
  label,
  sections,
  className,
}: {
  label: string;
  sections: readonly { id: string; label: string }[];
  className?: string;
}) {
  if (sections.length < 2) return null;

  return (
    <nav aria-label={label} className={cn("owner-section-links", className)}>
      {sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
    </nav>
  );
}
