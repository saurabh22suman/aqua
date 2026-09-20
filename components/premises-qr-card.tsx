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
    <div className="mt-5 rounded-card border border-line bg-paper p-4">
      <div className="flex justify-center">
        <LinkQr url={url} size={220} />
      </div>
      <p className="mt-3 break-all text-center text-[12px] text-ink-3">
        {url}
      </p>
      <Button
        variant="secondary"
        size="md"
        className="mt-3 w-full"
        onClick={() => window.print()}
      >
        Print this page
      </Button>
    </div>
  );
}
