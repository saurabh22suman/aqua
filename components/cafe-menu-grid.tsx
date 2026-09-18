"use client";

import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/money/format";
import type { MenuCategoryRow, MenuItemRow } from "@/lib/services/menu";

// K-07 — the counter menu grid, grouped by category. Add is the
// only action; quantities live in the cart. Once an order is
// placed the grid locks (there is no service to edit a placed
// order).

export function CafeLocationSwitcher({
  locations,
  locationId,
  onSelect,
}: {
  locations: { id: string; name: string }[];
  locationId: string;
  onSelect: (locationId: string) => void;
}) {
  if (locations.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {locations.map((location) => (
        <Button
          key={location.id}
          size="sm"
          variant={location.id === locationId ? "primary" : "secondary"}
          onClick={() => onSelect(location.id)}
          aria-pressed={location.id === locationId}
        >
          {location.name}
        </Button>
      ))}
    </div>
  );
}

export function CafeMenuGrid({
  categories,
  items,
  locked,
  onAdd,
}: {
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
  locked: boolean;
  onAdd: (itemId: string) => void;
}) {
  return (
    <section className="space-y-4" data-testid="cafe-menu">
      {categories.map((category) => {
        const categoryItems = items.filter(
          (item) => item.categoryId === category.id,
        );
        if (categoryItems.length === 0) return null;
        return (
          <div key={category.id}>
            <h2 className="font-display text-[15px] font-semibold text-ink">
              {category.name}
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {categoryItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-card border border-line bg-paper p-3 flex flex-col justify-between gap-2"
                  data-testid={`cafe-item-${item.id}`}
                >
                  <div>
                    <p className="text-[14px] font-medium text-ink leading-tight">
                      {item.name}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {formatINR(item.pricePaise)}
                      {item.isVeg ? " · Veg" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={locked}
                    onClick={() => onAdd(item.id)}
                    aria-label={`Add ${item.name}`}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
