"use client";

import { useEffect, useState } from "react";
import { LinkQr } from "@/components/link-qr";
import { Button } from "@/components/ui/Button";

// V-25 — the printable premises QR. The server mints the signed token
// and passes the relative path; the origin comes from the browser so
// the printed URL is the host the owner is actually on (the same
// pattern as the invitations board). No token leaves the page.

export function PremisesQrCard({ urlPath }: { urlPath: string }) {
  const [url, setUrl] = useState(urlPath);

  useEffect(() => {
    setUrl(`${window.location.origin}${urlPath}`);
  }, [urlPath]);

  return (
    <div className="mt-5">
      <div
        data-testid="premises-qr-poster"
        data-print-isolate="premises-qr"
        className="print-isolate-block rounded-card border border-line bg-paper p-5"
      >
        <h2 className="text-center font-display text-[22px] font-semibold">
          Staff check-in
        </h2>
        <p className="mx-auto mt-1 max-w-[32ch] text-center text-[13px] text-ink-3">
          Scan the academy&rsquo;s code, sign in, then confirm your own check-in.
        </p>
        <div className="mt-5 flex justify-center">
          <LinkQr url={url} size={220} />
        </div>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3 text-center">
          If the camera cannot scan, open this link by hand
        </p>
        <p className="mt-1 break-all text-center text-[12px] text-ink-3">
          {url}
        </p>
      </div>
      <Button
        variant="secondary"
        size="md"
        className="mt-3 w-full print:hidden"
        onClick={() => window.print()}
      >
        Print poster
      </Button>
    </div>
  );
}
