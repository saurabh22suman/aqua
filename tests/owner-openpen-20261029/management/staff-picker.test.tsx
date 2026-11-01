// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// India-first item 6 — staff linking by person search, never a raw UUID.
// RED captured before the staff candidate action exists (backend-D owns it).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const createStaffAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/staff", () => ({
  createStaffAction,
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

import { StaffCreateForm } from "@/components/staff-create-form";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  createStaffAction.mockReset();
});

describe("staff person search", () => {
  it("offers name/phone search instead of a raw person id", () => {
    render(<StaffCreateForm terminology={{ locale: "en", overrides: {} }} />);

    fireEvent.click(screen.getByRole("button", { name: /existing person/i }));

    expect(
      screen.getByRole("searchbox", { name: /find a person by name or phone/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/existing person id/i)).toBeNull();
    expect(
      screen.queryByPlaceholderText("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("searches by name/phone, requires an explicit choice and keeps the payload", async () => {
    createStaffAction.mockResolvedValue({ kind: "ok", staffId: "s1" });
    const search = vi.fn().mockResolvedValue([
      { personId: "person-1", fullName: "Asha Rao", phone: "90000 00101" },
      { personId: "person-2", fullName: "Vikram Nair", phone: null },
    ]);

    render(
      <StaffCreateForm
        terminology={{ locale: "en", overrides: {} }}
        searchCandidates={search}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /existing person/i }));

    const save = screen.getByTestId("staff-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(
      screen.getByRole("searchbox", { name: /find a person by name or phone/i }),
      { target: { value: "Asha" } },
    );
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(search).toHaveBeenCalledWith("Asha");

    fireEvent.click(screen.getByRole("button", { name: /Asha Rao/ }));
    expect(screen.getByTestId("staff-person-preview").textContent).toContain(
      "Asha Rao",
    );
    expect(screen.getByTestId("staff-person-preview").textContent).toContain(
      "+91 90000 00101",
    );
    expect(
      screen.getByRole("button", { name: "Change person" }),
    ).toBeTruthy();
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() =>
      expect(createStaffAction).toHaveBeenCalledWith({
        staffType: "coach",
        existingPersonId: "person-1",
      }),
    );
  });

  it("invalidates an in-flight result when the query becomes too short", async () => {
    const slow = deferred<Array<{ personId: string; fullName: string; phone: string | null }>>();
    const search = vi.fn().mockReturnValue(slow.promise);
    render(
      <StaffCreateForm
        terminology={{ locale: "en", overrides: {} }}
        searchCandidates={search}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /existing person/i }));
    const input = screen.getByRole("searchbox", {
      name: /find a person by name or phone/i,
    });
    fireEvent.change(input, { target: { value: "Asha" } });
    await waitFor(() => expect(search).toHaveBeenCalled());

    fireEvent.change(input, { target: { value: "A" } });
    slow.resolve([{ personId: "p-old", fullName: "Old Result", phone: null }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Old Result")).toBeNull();
  });

  it("clears old results immediately and ignores out-of-order responses", async () => {
    const first = deferred<Array<{ personId: string; fullName: string; phone: string | null }>>();
    const second = deferred<Array<{ personId: string; fullName: string; phone: string | null }>>();
    const search = vi.fn().mockImplementation((q: string) =>
      q === "As" ? first.promise : second.promise,
    );
    render(
      <StaffCreateForm
        terminology={{ locale: "en", overrides: {} }}
        searchCandidates={search}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /existing person/i }));
    const input = screen.getByRole("searchbox", {
      name: /find a person by name or phone/i,
    });
    fireEvent.change(input, { target: { value: "As" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("As"));
    first.resolve([{ personId: "p1", fullName: "First Person", phone: null }]);
    expect(await screen.findByText("First Person")).toBeTruthy();

    fireEvent.change(input, { target: { value: "Asha" } });
    expect(screen.queryByText("First Person")).toBeNull();

    second.resolve([{ personId: "p2", fullName: "Second Person", phone: null }]);
    expect(await screen.findByText("Second Person")).toBeTruthy();

    first.resolve([{ personId: "p3", fullName: "Late Old Person", phone: null }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Late Old Person")).toBeNull();
    expect(screen.queryByText("First Person")).toBeNull();
  });

  it("prevents a partial optional employment date from being silently dropped", async () => {
    createStaffAction.mockResolvedValue({ kind: "ok", staffId: "s1" });
    render(<StaffCreateForm terminology={{ locale: "en", overrides: {} }} />);

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Asha Rao" },
    });
    const employed = screen.getByLabelText(/Employed on/i) as HTMLInputElement;
    fireEvent.change(employed, { target: { value: "30/10" } });

    const save = screen.getByTestId("staff-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(
      /complete date.*or leave it blank/i,
    );
    fireEvent.click(save);
    expect(createStaffAction).not.toHaveBeenCalled();
  });

  it("explains an empty result without inventing a person", async () => {
    render(
      <StaffCreateForm
        terminology={{ locale: "en", overrides: {} }}
        searchCandidates={vi.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /existing person/i }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: /find a person by name or phone/i }),
      { target: { value: "zz" } },
    );

    expect(await screen.findByText(/No matching person/i)).toBeTruthy();
    expect(screen.queryByTestId("staff-person-preview")).toBeNull();
  });
});
