import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";

// Owner Today — one total in the lower scoreline.
//
// An in-page destination is a plain anchor (the browser's own jump), a
// real route is the owner Link, and a total the caller cannot drill into
// is static text. The cell never invents a destination.
export function OwnerScoreCell({
  count,
  label,
  icon,
  href,
}: {
  count: number;
  label: string;
  icon: OwnerIconName;
  href?: string;
}) {
  const content = (
    <>
      <span className="courtside-score-icon"><OwnerIcon name={icon} size={17} /></span>
      <strong>{count}</strong><span>{label}</span>
    </>
  );
  return (
    <li>
      {href?.startsWith("#") ? <a href={href}>{content}</a> :
        href ? <Link href={href}>{content}</Link> : <span className="courtside-score-static">{content}</span>}
    </li>
  );
}
