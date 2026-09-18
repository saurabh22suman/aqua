// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// K-07 — owner café menu manager render tests.
//   * empty state with the add-category verb
//   * adding a category sends the location
//   * adding an item converts ₹ and % to integer paise / basis points
//   * hide/show toggles the item through the update action

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const createMenuCategoryAction = vi.hoisted(() => vi.fn());
const updateMenuCategoryAction = vi.hoisted(() => vi.fn());
const archiveMenuCategoryAction = vi.hoisted(() => vi.fn());
const createMenuItemAction = vi.hoisted(() => vi.fn());
const updateMenuItemAction = vi.hoisted(() => vi.fn());
const archiveMenuItemAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/menu", () => ({
  createMenuCategoryAction,
  updateMenuCategoryAction,
  archiveMenuCategoryAction,
  createMenuItemAction,
  updateMenuItemAction,
  archiveMenuItemAction,
}));

import { MenuManager } from "@/components/menu-manager";
import type { MenuCategoryRow, MenuItemRow } from "@/lib/services/menu";

const LOCATION = "11111111-1111-7111-8111-111111111111";
const LOCATIONS = [{ id: LOCATION, name: "Worli" }];

const CATEGORY: MenuCategoryRow = {
  id: "c1",
  locationId: LOCATION,
  name: "Beverages",
  sortOrder: 0,
  isActive: true,
};

const ITEM: MenuItemRow = {
  id: "i1",
  locationId: LOCATION,
  categoryId: "c1",
  name: "Masala chai",
  pricePaise: 25000,
  taxRateBp: 500,
  sacCode: "996331",
  isVeg: true,
  isActive: true,
};

function renderManager(
  categories: MenuCategoryRow[] = [],
  items: MenuItemRow[] = [],
) {
  return render(
    <MenuManager
      categories={categories}
      items={items}
      locations={LOCATIONS}
    />,
  );
}

beforeEach(() => {
  createMenuCategoryAction.mockResolvedValue({ ok: true, id: "c2" });
  createMenuItemAction.mockResolvedValue({ ok: true, id: "i2" });
  updateMenuItemAction.mockResolvedValue({ ok: true, id: "i1" });
  updateMenuCategoryAction.mockResolvedValue({ ok: true, id: "c1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MenuManager — empty and category states", () => {
  it("shows the empty state and the add-category form", () => {
    renderManager();
    expect(screen.getByTestId("menu-empty").textContent).toMatch(
      /no categories yet/i,
    );
    expect(screen.getByTestId("menu-add-category")).toBeTruthy();
  });

  it("adds a category with the selected location", async () => {
    renderManager();
    fireEvent.change(screen.getByTestId("menu-category-name"), {
      target: { value: "Snacks" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));

    await vi.waitFor(() =>
      expect(createMenuCategoryAction).toHaveBeenCalledWith({
        locationId: LOCATION,
        name: "Snacks",
      }),
    );
  });

  it("renders existing categories and their items", () => {
    renderManager([CATEGORY], [ITEM]);
    expect(screen.getByTestId("menu-category-c1").textContent).toContain(
      "Beverages",
    );
    expect(screen.getByTestId("menu-item-i1").textContent).toContain(
      "Masala chai",
    );
  });
});

describe("MenuManager — item writes", () => {
  it("converts ₹ price to integer paise and % GST to basis points", async () => {
    renderManager([CATEGORY], []);
    fireEvent.change(screen.getByTestId("menu-new-item-c1-name"), {
      target: { value: "Masala chai" },
    });
    fireEvent.change(screen.getByTestId("menu-new-item-c1-price"), {
      target: { value: "250.50" },
    });
    fireEvent.change(screen.getByTestId("menu-new-item-c1-tax"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("menu-new-item-c1-sac"), {
      target: { value: "996331" },
    });
    fireEvent.click(screen.getByTestId("menu-new-item-c1-veg"));
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    await vi.waitFor(() =>
      expect(createMenuItemAction).toHaveBeenCalledWith({
        categoryId: "c1",
        name: "Masala chai",
        pricePaise: 25050,
        taxRateBp: 500,
        sacCode: "996331",
        isVeg: true,
      }),
    );
  });

  it("rejects a bad price before calling the action", () => {
    renderManager([CATEGORY], []);
    fireEvent.change(screen.getByTestId("menu-new-item-c1-name"), {
      target: { value: "Masala chai" },
    });
    fireEvent.change(screen.getByTestId("menu-new-item-c1-price"), {
      target: { value: "2,5!" },
    });
    fireEvent.change(screen.getByTestId("menu-new-item-c1-tax"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    expect(createMenuItemAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/price like 250/i);
  });

  it("hides an item through updateMenuItemAction", async () => {
    renderManager([CATEGORY], [ITEM]);
    const itemRow = screen.getByTestId("menu-item-i1");
    fireEvent.click(within(itemRow).getByRole("button", { name: "Hide" }));

    await vi.waitFor(() =>
      expect(updateMenuItemAction).toHaveBeenCalledWith({
        itemId: "i1",
        isActive: false,
      }),
    );
  });
});
