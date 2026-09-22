// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LaneStrip } from "@/components/ui/LaneStrip";
import { StatCard } from "@/components/ui/StatCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AttentionRow } from "@/components/ui/AttentionRow";
import { CountChip } from "@/components/ui/CountChip";
import { RunwayStrip } from "@/components/ui/RunwayStrip";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { LineTrend } from "@/components/charts";

// PR3-C2 — render contracts for the shared primitives. Each one is
// used by a real screen; these tests pin the behaviour the screens
// rely on (labels, tones, links, empty handling).

afterEach(cleanup);

describe("ProgressBar", () => {
  it("clamps and exposes an accessible value", () => {
    render(<ProgressBar value={12} max={10} label="Capacity" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("12");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");
    expect(bar.querySelector(".bg-water")).toBeTruthy();
  });

  it("uses the warn tone when asked", () => {
    render(<ProgressBar value={2} max={10} tone="warn" />);
    expect(document.querySelector(".bg-warn")).toBeTruthy();
  });
});

describe("LaneStrip", () => {
  it("renders time, title, count and capacity bar", () => {
    render(
      <LaneStrip
        time="6:00 am"
        title="Morning Masters"
        subtitle="Stroke development"
        started={16}
        ended={2}
        testId="owner-lane"
      />,
    );
    const lane = screen.getByTestId("owner-lane");
    expect(lane.textContent).toContain("6:00 am Morning Masters");
    expect(lane.textContent).toContain("2");
    expect(lane.textContent).toContain("/16");
    expect(lane.querySelector('[role="progressbar"]')).toBeTruthy();
  });
});

describe("StatCard", () => {
  it("renders a linked KPI with a real delta and hint", () => {
    render(
      <StatCard
        label="Active swimmers"
        value="33"
        hint="11 joined this month"
        delta={{ direction: "up", text: "+3" }}
        href="/owner/members"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/owner/members");
    expect(link.textContent).toContain("33");
    expect(link.textContent).toContain("+3");
  });

  it("omits the delta when null (no fabricated comparison)", () => {
    render(<StatCard label="Attendance" value="88%" delta={null} />);
    expect(document.body.textContent).not.toContain("%+");
  });
});

describe("SectionHeader", () => {
  it("renders title, subtitle and trailing content", () => {
    render(
      <SectionHeader
        title="Needs you today"
        subtitle="Two follow-ups are overdue"
        trailing={<CountChip count={2} tone="warn" />}
      />,
    );
    expect(screen.getByText("Needs you today")).toBeTruthy();
    expect(screen.getByText("Two follow-ups are overdue")).toBeTruthy();
    expect(screen.getByTestId("count-chip").textContent).toContain("2");
  });
});

describe("AttentionRow", () => {
  it("is a link when actionable and inert otherwise", () => {
    const { unmount } = render(
      <AttentionRow title="Follow-up overdue" detail="Meera Nair" href="/owner/enquiries/1" />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/owner/enquiries/1");
    unmount();

    render(<AttentionRow title="Register not started" detail="Morning Masters" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toContain("Register not started");
  });
});

describe("CountChip", () => {
  it("shows the count and optional label", () => {
    render(<CountChip count={3} label="lapsed" tone="late" />);
    expect(screen.getByTestId("count-chip").textContent).toContain("3 lapsed");
  });
});

describe("RunwayStrip", () => {
  it("computes days left from real dates and warns near the end", () => {
    render(
      <RunwayStrip
        label="Monthly plan"
        startLabel="1 Sept 2026"
        endLabel="30 Sept 2026"
        usedDays={25}
        totalDays={30}
      />,
    );
    const strip = screen.getByTestId("runway-strip");
    expect(strip.textContent).toContain("5 of 30 days left");
    expect(strip.querySelector(".bg-warn")).toBeTruthy();
  });

  it("reads Ended when expired", () => {
    render(
      <RunwayStrip
        label="Monthly plan"
        startLabel="1 Aug 2026"
        endLabel="31 Aug 2026"
        usedDays={31}
        totalDays={30}
        expired
      />,
    );
    expect(document.body.textContent).toContain("Ended");
  });
});

describe("SegmentedTabs", () => {
  it("marks the active tab and links the rest", () => {
    render(
      <SegmentedTabs
        active="dues"
        tabs={[
          { key: "overview", label: "Overview", href: "/owner/fees?tab=overview" },
          { key: "dues", label: "Dues", href: "/owner/fees?tab=dues" },
        ]}
      />,
    );
    const active = screen.getByRole("link", { name: "Dues" });
    expect(active.getAttribute("aria-current")).toBe("page");
  });
});

describe("StickyActionBar", () => {
  it("renders its action in a sticky container", () => {
    render(
      <StickyActionBar>
        <button type="button">Save</button>
      </StickyActionBar>,
    );
    const bar = screen.getByTestId("sticky-action-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.textContent).toContain("Save");
  });
});

describe("DataTable", () => {
  type Row = { id: string; name: string; due: number };
  const columns = [
    { key: "name", label: "Name", render: (row: Row) => row.name },
    { key: "due", label: "Due", align: "right" as const, render: (row: Row) => row.due },
  ];

  it("renders a real table and fires row clicks", () => {
    let clicked = "";
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "1", name: "Asha", due: 100 }]}
        rowKey={(row) => row.id}
        onRowClick={(row) => {
          clicked = row.id;
        }}
      />,
    );
    const table = screen.getByTestId("data-table");
    expect(table.querySelector("table")).toBeTruthy();
    expect(table.textContent).toContain("Asha");
    table.querySelector("tbody tr")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toBe("1");
  });

  it("renders the caller's empty state when there are no rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<EmptyState title="No members yet" secondaryAction={{ label: "Import a CSV", href: "/owner/members/import" }} />}
      />,
    );
    expect(screen.getByText("No members yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Import a CSV" }).getAttribute("href")).toBe(
      "/owner/members/import",
    );
  });
});

describe("charts extraction (PR3-C2)", () => {
  it("re-exports the chart primitives from components/charts", () => {
    render(
      <LineTrend
        ariaLabel="Attendance percentage by day, 2 days"
        maxValue={100}
        points={[
          { label: "2026-09-01", value: 75, hint: "1 Sept: 75%" },
          { label: "2026-09-02", value: 88, hint: "2 Sept: 88%" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /attendance percentage by day/i })).toBeTruthy();
  });
});
