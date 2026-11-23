import Link from "next/link";

export function SelfWorkspaceNav({ home, current, showAnnouncements = true }: {
  home: "/member" | "/family";
  current: "home" | "announcements" | "account";
  showAnnouncements?: boolean;
}) {
  return (
    <nav aria-label="Workspace" className="self-shortcuts self-workspace-nav">
      <Link href={home} aria-current={current === "home" ? "page" : undefined}>Home</Link>
      {showAnnouncements ? (
        <Link href={`${home}/announcements`} aria-current={current === "announcements" ? "page" : undefined}>Announcements</Link>
      ) : null}
      <Link href={`${home}/account`} aria-current={current === "account" ? "page" : undefined}>Account</Link>
    </nav>
  );
}
