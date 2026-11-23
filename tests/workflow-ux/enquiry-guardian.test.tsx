// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EnquiryNewMemberFields } from "@/components/enquiry-new-member-fields";
import type { PersonSearchRow } from "@/lib/services/people";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/people", () => ({ searchPersonsAction: search }));
vi.mock("@/components/ui/DateField", () => ({
  DateField: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("2016-04-03")}>Set minor DOB</button>
  ),
}));

it("ignores late guardian results and requires a fresh relationship and consent after changing the guardian", async () => {
  let finishOld!: (rows: Partial<PersonSearchRow>[]) => void;
  search.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce([{ personId: "new-match", fullName: "Priya Joshi" }]);
  const onChange = vi.fn();
  render(<EnquiryNewMemberFields locations={[{ id: "site", name: "Worli" }]} initialLocationId="site" onChange={onChange} onValidityChange={vi.fn()} terminology={{ overrides: {}, locale: "en" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Set minor DOB" }));
  const field = screen.getByRole("textbox", { name: "Search existing guardian" });
  fireEvent.change(field, { target: { value: "Pre" } });
  fireEvent.change(field, { target: { value: "Priya" } });
  expect(await screen.findByRole("button", { name: "Priya Joshi" })).toBeTruthy();
  await act(async () => finishOld([{ personId: "stale", fullName: "Preeti Shah" }]));
  expect(screen.queryByRole("button", { name: "Preeti Shah" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Priya Joshi" }));
  fireEvent.click(screen.getByTestId("enquiry-consent-checkbox"));
  expect(onChange).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByRole("textbox", { name: /relationship/i }), { target: { value: "Mother" } });
  fireEvent.click(screen.getByTestId("enquiry-consent-checkbox"));
  expect(onChange.mock.lastCall?.[0]?.guardian).toEqual({ existingPersonId: "new-match", relationship: "Mother" });
  fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
  expect((screen.getByTestId("enquiry-consent-checkbox") as HTMLInputElement).checked).toBe(false);
  expect(onChange).toHaveBeenLastCalledWith(null);
});
