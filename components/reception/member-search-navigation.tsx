"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { BackLink } from "@/components/ui/BackLink";

let searchOrigin: { token: string; namespace: string; memberId: string } | null = null;

function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function ReceptionMemberResultLink({ memberId, namespace, className, children }: {
  memberId: string;
  namespace: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const href = `/reception/members/${memberId}`;

  return (
    <Link href={href} className={className} data-testid={`member-result-${memberId}`} onClick={(event) => {
      if (!plainClick(event) || !globalThis.crypto?.randomUUID) return;
      const token = globalThis.crypto.randomUUID();
      searchOrigin = { token, namespace, memberId };
      event.preventDefault();
      // The URL carries only a one-use browser navigation marker.
      // The search term remains on its original history entry.
      router.push(`${href}?searchReturn=${token}`);
    }}>
      {children}
    </Link>
  );
}

export function BackToReceptionSearch({ memberId, namespace, token }: {
  memberId: string;
  namespace: string;
  token?: string;
}) {
  const router = useRouter();
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return <BackLink href="/reception/members" label="Search" />;

  return (
    <Link href="/reception/members" className="mb-4 inline-flex min-h-11 items-center text-sm text-ink-2 underline" onClick={(event) => {
      if (!plainClick(event) || !searchOrigin || searchOrigin.token !== token || searchOrigin.namespace !== namespace || searchOrigin.memberId !== memberId) return;
      searchOrigin = null;
      event.preventDefault();
      router.back();
    }}>
      Back to search results
    </Link>
  );
}
