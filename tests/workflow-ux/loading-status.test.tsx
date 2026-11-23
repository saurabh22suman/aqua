// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CoachRegisterLoading from "@/app/(coach)/coach/register/[sessionId]/loading";
import MembersLoading from "@/app/(owner)/owner/members/loading";
import ScheduleLoading from "@/app/(owner)/owner/schedule/loading";
import ReceptionLoading from "@/app/(reception)/reception/loading";
import FamilyLoading from "@/app/(self)/family/loading";

afterEach(cleanup);

describe("route loading announcements", () => {
  it.each([
    ["Coach register", CoachRegisterLoading],
    ["Owner members", MembersLoading],
    ["Owner schedule", ScheduleLoading],
    ["Reception", ReceptionLoading],
    ["Family", FamilyLoading],
  ] as const)("%s has one loading message that is available to assistive technology", (_name, Loading) => {
    render(<Loading />);
    const [status] = screen.getAllByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status?.textContent).toMatch(/^Loading .+…$/);
    expect(status?.closest('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
