// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
import { BackLink } from "@/components/ui/BackLink";
import { MembersReturnLink } from "@/components/members-return-link";
import { clearMembersReturnIntent, peekMembersReturnIntent, recordMembersReturnIntent } from "@/components/members-list-navigation";

const site = "11111111-1111-4111-8111-111111111111";
afterEach(() => { cleanup(); clearMembersReturnIntent(); replace.mockClear(); });

it("returns a deep-linked all-facilities profile to explicit all instead of a device cookie", () => {
  render(<MembersReturnLink namespace="club:owner" facility="all"><BackLink href="/owner/members" label="Members" /></MembersReturnLink>);
  expect(screen.getByRole("link", { name: "Members" }).getAttribute("href")).toBe("/owner/members?facility=all");
  fireEvent.click(screen.getByRole("link", { name: "Members" }));
  expect(replace).toHaveBeenCalledWith("/owner/members?facility=all");
});

it("keeps a matching directory search and scroll return intent", () => {
  recordMembersReturnIntent({ namespace:"club:owner",locationId:site,search:"Local",status:"active",scrollY:450 });
  render(<MembersReturnLink namespace="club:owner" facility={site}><BackLink href="/owner/members" label="Members" /></MembersReturnLink>);
  fireEvent.click(screen.getByRole("link", { name: "Members" }));
  expect(replace).toHaveBeenCalledWith(`/owner/members?facility=${site}`);
  expect(peekMembersReturnIntent("club:owner", site)).toEqual({ namespace:"club:owner",locationId:site,search:"Local",status:"active",scrollY:450 });
});

it.each(["other-club:owner", "club:other-owner"])("does not arm a stale directory return from %s", (namespace) => {
  recordMembersReturnIntent({ namespace,locationId:site,search:"Old search",status:"active",scrollY:450 });
  render(<MembersReturnLink namespace="club:owner" facility="all"><BackLink href="/owner/members" label="Members" /></MembersReturnLink>);
  fireEvent.click(screen.getByRole("link", { name: "Members" }));
  expect(replace).toHaveBeenCalledWith("/owner/members?facility=all");
  expect(peekMembersReturnIntent(namespace, site)).toBeNull();
});
