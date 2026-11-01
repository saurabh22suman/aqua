// @vitest-environment jsdom
//
// Owner children error boundary (30 Oct 2026).
//
// A failing owner read used to fall through to the framework's default
// "Application error" surface: no retry, no way back, and no owner copy.
// This regression renders a real throwing owner child inside an error
// boundary. When app/(owner)/owner/error.tsx exists, the harness resolves
// and renders that actual component; before it exists, the harness shows
// the framework-default fallback. The RED is therefore the missing visible
// recovery surface, not a missing import.
//
// The boundary is scoped below app/(owner)/layout.tsx: it catches owner
// child-route failures, not a failure of the shell/auth layout itself.

import { Component, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

type OwnerErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};
type OwnerErrorComponent = ComponentType<OwnerErrorProps>;

declare global {
  interface ImportMeta {
    glob: <T>(
      pattern: string,
      options: { eager: true },
    ) => Record<string, T>;
  }
}

const ownerErrorModules = import.meta.glob<{ default: OwnerErrorComponent }>(
  "../../../app/(owner)/owner/error.tsx",
  { eager: true },
);
const OwnerError = Object.values(ownerErrorModules)[0]?.default ?? null;

function FrameworkDefaultError() {
  return (
    <main>
      <h1>Application error</h1>
      <p>A server-side exception has occurred.</p>
    </main>
  );
}

function SensitiveFailure(): never {
  const error = new Error(
    "SENSITIVE member DOB 2015-05-14; query memberId=abc",
  ) as Error & { digest?: string };
  error.digest = "digest-123";
  throw error;
}

type BoundaryState = {
  error: OwnerErrorProps["error"] | null;
  recovered: boolean;
};

class TestBoundary extends Component<
  { fallback: OwnerErrorComponent; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, recovered: false };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  private reset = () => {
    this.setState({ error: null, recovered: true });
  };

  render() {
    if (this.state.recovered) return <p>Recovered owner page</p>;
    if (this.state.error) {
      const Fallback = this.props.fallback;
      return <Fallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("owner child-route error boundary", () => {
  it("offers a truthful retry and a safe way back, without private details", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fallback = OwnerError ?? FrameworkDefaultError;
    render(
      <TestBoundary fallback={fallback}>
        <SensitiveFailure />
      </TestBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: /this page could not be loaded/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeTruthy();
    const back = screen.getByRole("link", { name: /back to dashboard/i });
    expect(back.getAttribute("href")).toBe("/owner");

    expect(screen.queryByText(/SENSITIVE member DOB/i)).toBeNull();
    expect(screen.queryByText(/digest-123/i)).toBeNull();
  });

  it("re-runs the owner segment when the user retries", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fallback = OwnerError ?? FrameworkDefaultError;
    render(
      <TestBoundary fallback={fallback}>
        <SensitiveFailure />
      </TestBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("Recovered owner page")).toBeTruthy();
  });
});
