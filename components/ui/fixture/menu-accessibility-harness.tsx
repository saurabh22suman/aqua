"use client";

import { MoreHorizontal, User } from "lucide-react";

import { Menu } from "@/components/ui/Menu";
import { ComponentFixture } from "@/components/ui/fixture/component-fixture";

// UI foundation — Menu accessibility harness.
//
// A TEST fixture (like components/ui/fixture/component-fixture.tsx):
// it shows the Menu primitive in the states the acceptance contract
// asks about — the real consumer call shape, an icon-only trigger, a
// long menu that must scroll inside the viewport, a trigger near the
// bottom of the page and an empty menu.
//
// It is rendered by a browser check, never mounted on a public route.
// Mount it from a throwaway page while collecting evidence:
//
//   app/owner/menu-harness/page.tsx
//   import { MenuAccessibilityHarness } from "@/components/ui/fixture/menu-accessibility-harness";
//   export default function Page() { return <MenuAccessibilityHarness />; }
//
// "/owner/…" is served by the apex host (lib/surface-paths.ts), so the
// middleware lets the throwaway page reach the app without touching
// the allowlist.

const LONG_ITEMS = Array.from({ length: 24 }, (_, index) => ({
  label: `Long menu action ${index + 1}`,
}));

const ACCOUNT_ITEMS = [
  { label: "Profile" },
  { label: "Appearance" },
  { label: "Sign out" },
];

export function MenuAccessibilityHarness() {
  return (
    <div className="space-y-8 bg-deck px-5 py-6" data-testid="menu-accessibility-harness">
      <section className="space-y-3">
        <h1 className="font-display text-[20px] font-semibold text-ink">
          Menu accessibility harness
        </h1>
        <p className="text-[13px] text-ink-2">
          Foundation states for the shared Menu. Synthetic labels only.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Menu label="Account" trigger="Account" items={ACCOUNT_ITEMS} />
          <Menu
            label="Account"
            trigger={<User size={18} strokeWidth={1.8} aria-hidden="true" />}
            items={ACCOUNT_ITEMS}
          />
          <Menu
            label="More actions"
            trigger={<MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />}
            items={ACCOUNT_ITEMS}
          />
          <Menu label="Nothing yet" trigger="Empty" items={[]} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Long menu (must scroll inside the viewport)
        </h2>
        <Menu label="Long menu" trigger="Long menu" items={LONG_ITEMS} align="start" />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Long labels (must wrap, never widen the page)
        </h2>
        <Menu
          label="Long labels"
          trigger="Long labels"
          items={[
            { label: "Close the attendance register for the finished batch" },
            { label: "Send the monthly dues reminder to every member on the plan" },
          ]}
          align="start"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Inside a scrolling column (the column clips the menu)
        </h2>
        <div className="h-56 overflow-auto rounded-ctl border border-line bg-paper p-3">
          <div className="h-40" />
          <Menu
            label="Column menu"
            trigger="Column menu"
            items={LONG_ITEMS}
            align="start"
          />
          <div className="h-40" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Trigger near the bottom of the viewport
        </h2>
        <div className="h-[1200px]" />
        <Menu label="Bottom menu" trigger="Bottom menu" items={ACCOUNT_ITEMS} align="start" />
        <div className="h-[600px]" />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Shared component fixture (the real Menu consumer)
        </h2>
        <ComponentFixture />
      </section>
    </div>
  );
}
