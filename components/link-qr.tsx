"use client";

import { useEffect, useState } from "react";

// QR for a minted login/reset link (2026-09-11 auth feature).
//
// The QR encodes exactly the URL the copy button shows. `qrcode` is
// imported lazily so it only loads when a link is actually displayed
// — the panels render this after minting, so the cost lands on the
// interaction, not the route's first load. Nothing about the URL
// leaves the browser: the token is already in the panel.
export function LinkQr({
  url,
  size = 180,
}: {
  url: string;
  size?: number;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { toString } = await import("qrcode");
      const out = await toString(url, { type: "svg", margin: 1, width: size });
      if (!cancelled) setSvg(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (svg === null) {
    return (
      <div
        data-testid="link-qr-loading"
        aria-hidden
        className="h-[180px] w-[180px] rounded-ctl border border-line bg-paper"
      />
    );
  }
  return (
    <div
      data-testid="link-qr"
      className="inline-block rounded-ctl border border-line bg-paper p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
