"use client";

import { useEffect, useRef, useState } from "react";

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
  onError,
}: {
  url: string;
  size?: number;
  onError?: () => void;
}) {
  const [rendered, setRendered] = useState<{
    url: string;
    size: number;
    svg: string;
  } | null>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    // A URL change starts from the placeholder. The previous SVG must not
    // remain scannable beside a new amount/payee while the new one encodes.
    setRendered(null);
    void (async () => {
      const { toString } = await import("qrcode");
      const out = await toString(url, { type: "svg", margin: 1, width: size });
      if (!cancelled) setRendered({ url, size, svg: out });
    })().catch(() => {
      if (!cancelled) {
        setRendered(null);
        onErrorRef.current?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  const svg =
    rendered && rendered.url === url && rendered.size === size
      ? rendered.svg
      : null;

  if (svg === null) {
    return (
      <div
        data-testid="link-qr-loading"
        aria-hidden
        style={{ width: size, height: size }}
        className="rounded-ctl border border-line bg-paper"
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
