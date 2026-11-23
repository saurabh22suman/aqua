import type { ReactNode } from "react";
import "./self-route.css";

export function SelfRouteFrame({ children }: { children: ReactNode }) {
  return <div className="self-route">{children}</div>;
}

export function SelfScreenLoading({ label }: { label: string }) {
  return (
    <main className="self-page" aria-busy="true">
      <div className="self-skel-top">
        <span className="self-skel self-skel-mark" />
        <span className="self-skel self-skel-brand" />
      </div>
      <div className="self-main">
        <div className="self-skel self-skel-mast" />
        <div className="self-skel self-skel-row" />
        <div className="self-card">
          <div className="self-skel-card">
            <span className="self-skel self-skel-line self-skel-line-short" />
            <span className="self-skel self-skel-line" />
            <span className="self-skel self-skel-line" />
          </div>
        </div>
        <div className="self-card">
          <div className="self-skel-card">
            <span className="self-skel self-skel-line self-skel-line-short" />
            <span className="self-skel self-skel-line" />
          </div>
        </div>
        <p className="self-loading-note" role="status">
          {label}
        </p>
      </div>
    </main>
  );
}
