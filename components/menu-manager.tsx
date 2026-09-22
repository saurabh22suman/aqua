"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  AddItemForm,
  MenuItemEditor,
} from "@/components/menu-item-editor";
import {
  archiveMenuCategoryAction,
  createMenuCategoryAction,
  updateMenuCategoryAction,
} from "@/lib/actions/menu";
import type { MenuCategoryRow, MenuItemRow } from "@/lib/services/menu";
import type { LocationOption } from "@/lib/services/people";

// K-07 — owner/admin café menu management. Categories and items are
// the K-01 service shapes; every write routes through the menu
// actions, which enforce settings.manage server-side. The manager
// never mutates without the action returning ok.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

function AddCategoryForm({ locations }: { locations: LocationOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !locationId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await createMenuCategoryAction({
        locationId,
        name: name.trim(),
      });
      setOk(result.ok);
      setMessage(result.ok ? "Category added." : result.error);
      if (result.ok) {
        setName("");
        router.refresh();
      }
    } catch {
      setOk(false);
      setMessage("The category could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-card border border-line bg-paper p-4 space-y-3"
      data-testid="menu-add-category"
    >
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Add a category
      </h2>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          Category name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Beverages"
          maxLength={120}
          className={inputClass}
          data-testid="menu-category-name"
        />
      </label>
      {locations.length > 1 ? (
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Facility
          </span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={inputClass}
            data-testid="menu-category-location"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={busy || name.trim().length === 0}
        >
          {busy ? "Saving…" : "Add category"}
        </Button>
        {message ? (
          <span
            role={ok ? "status" : "alert"}
            className="text-[12px] text-ink-2"
          >
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CategoryCard({
  category,
  locationName,
  items,
}: {
  category: MenuCategoryRow;
  locationName: string;
  items: MenuItemRow[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateMenuCategoryAction({
        categoryId: category.id,
        isActive: !category.isActive,
      });
      setMessage(result.ok ? "Updated." : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive "${category.name}" and its items?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await archiveMenuCategoryAction({
        categoryId: category.id,
      });
      setMessage(result.ok ? "Archived." : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-card border border-line bg-paper p-4"
      data-testid={`menu-category-${category.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[15px] font-display font-semibold text-ink">
            {category.name}
            {!category.isActive ? (
              <span className="ml-2 rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
                Hidden
              </span>
            ) : null}
          </p>
          <p className="text-[12px] text-ink-3">{locationName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={toggleActive}
          >
            {category.isActive ? "Hide" : "Show"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={archive}
          >
            Archive
          </Button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-2 divide-y divide-line border-t border-line">
          {items.map((item) => (
            <MenuItemEditor key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">
          No items yet — add the first one below.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-[var(--accent-ink)] underline underline-offset-2">
          Add item
        </summary>
        <AddItemForm categoryId={category.id} />
      </details>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function MenuManager({
  categories,
  items,
  locations,
}: {
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
  locations: LocationOption[];
}) {
  return (
    <div className="space-y-8">
      <AddCategoryForm locations={locations} />

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Categories
        </h2>
        {categories.length === 0 ? (
          <p
            className="mt-2 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3"
            data-testid="menu-empty"
          >
            No categories yet. Add the first category above, then items
            under it.
          </p>
        ) : (
          <div className="mt-2 space-y-4">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                locationName={
                  locations.find((l) => l.id === category.locationId)?.name ??
                  "Café"
                }
                items={items.filter((item) => item.categoryId === category.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
