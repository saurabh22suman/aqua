// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the OwnerLink facade.
//
// One decision, in one place: an OWNER destination reads on navigation
// (`prefetch={false}`), and every other destination keeps exactly the
// prefetch the caller asked for — so the shared renderers keep their
// behaviour for coach, reception and Ops.
//
// These tests spy on the INSTALLED next/link, so they prove the actual
// prop the framework would receive, not a class or a string.

const linkSpy = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  const SpyLink = React.forwardRef(function SpyLink(
    props: { href?: unknown; children?: unknown; [k: string]: unknown },
    ref: unknown,
  ) {
    const { href, children, ...rest } = props;
    linkSpy.calls.push({ href, ...rest });
    return React.createElement(
      "a",
      { href: typeof href === "string" ? href : "#", ref, ...rest },
      children as React.ReactNode,
    );
  });
  return { default: SpyLink };
});

import { OwnerLink, isOwnerDestination } from "@/components/owner-ui/owner-link";

afterEach(() => {
  cleanup();
  linkSpy.calls.length = 0;
});

function lastCall() {
  return linkSpy.calls[linkSpy.calls.length - 1]!;
}

describe("the owner destination boundary", () => {
  it("covers every owner shape, including a UrlObject pathname", () => {
    for (const href of [
      "/owner",
      "/owner/",
      "/owner/members",
      "/owner/members/new?facility=loc-1",
      "/owner#today",
      { pathname: "/owner/members" },
      { pathname: "/owner", query: { facility: "loc-1" } },
    ]) {
      expect(isOwnerDestination(href as never), String(JSON.stringify(href))).toBe(
        true,
      );
    }
  });

  it("does not swallow a sibling path", () => {
    for (const href of ["/ownerly", "/ownerly/members", "/coach", "/reception", "/ops", "/"]) {
      expect(isOwnerDestination(href), String(href)).toBe(false);
    }
    // A UrlObject with no pathname is not an owner destination.
    expect(isOwnerDestination({ hash: "#today" })).toBe(false);
  });
});

describe("OwnerLink — what the framework receives", () => {
  it("forces prefetch off for an owner destination", () => {
    render(<OwnerLink href="/owner/members">Members</OwnerLink>);
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(lastCall().prefetch).toBe(false);
  });

  it("forces prefetch off for an owner UrlObject, query and hash included", () => {
    render(
      <OwnerLink href={{ pathname: "/owner/members", query: { status: "active" } }}>
        Members
      </OwnerLink>,
    );
    expect(lastCall().prefetch).toBe(false);
    render(<OwnerLink href="/owner#today">Today</OwnerLink>);
    expect(lastCall().prefetch).toBe(false);
  });

  it("keeps the caller's prefetch for a non-owner destination", () => {
    render(<OwnerLink href="/coach/members">Coach</OwnerLink>);
    expect("prefetch" in lastCall()).toBe(true);
    expect(lastCall().prefetch).toBeUndefined();
    cleanup();
    linkSpy.calls.length = 0;
    render(
      <OwnerLink href="/reception" prefetch>
        Reception
      </OwnerLink>,
    );
    expect(lastCall().prefetch).toBe(true);
  });

  it("forwards href, events, replace, scroll and accessibility", () => {
    const onClick = vi.fn();
    render(
      <OwnerLink
        href="/owner/members?status=active#list"
        replace
        scroll={false}
        onClick={onClick}
        aria-current="page"
        data-testid="owner-link"
      >
        Members
      </OwnerLink>,
    );
    const call = lastCall();
    expect(call.href).toBe("/owner/members?status=active#list");
    expect(call.replace).toBe(true);
    expect(call.scroll).toBe(false);
    expect(call["aria-current"]).toBe("page");
    expect(call["data-testid"]).toBe("owner-link");
    expect(call.prefetch).toBe(false);
  });

  it("forwards a ref to the anchor", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <OwnerLink ref={ref} href="/owner/settings">
        Settings
      </OwnerLink>,
    );
    expect(ref.current?.tagName).toBe("A");
    expect(ref.current?.getAttribute("href")).toBe("/owner/settings");
  });
});
