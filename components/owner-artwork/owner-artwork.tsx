"use client";
import { useEffect, useRef, useState } from "react";
import { ArtworkChooser } from "./artwork-chooser";
import { DEFAULT_MOTIF, readArtwork, type ArtworkIdentity, type Motif } from "./preference";

export function OwnerArtwork({ identity, mode = "decoration" }: { identity?: ArtworkIdentity; mode?: "decoration" | "chooser" }) {
  if (mode === "chooser") return identity ? <ArtworkChooser identity={identity} renderArtwork={motif => <ArtworkMask motif={motif} />} /> : null;
  return <ArtworkDecoration identity={identity} />;
}

function ArtworkDecoration({ identity }: { identity?: ArtworkIdentity }) {
  const [motif, setMotif] = useState(DEFAULT_MOTIF);
  useEffect(() => {
    const refresh = () => setMotif(identity ? readArtwork(identity) : DEFAULT_MOTIF);
    refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("pageshow", refresh); window.removeEventListener("focus", refresh); };
  }, [identity?.tenantId, identity?.userId, identity]);
  return <ArtworkMask motif={motif} />;
}

function ArtworkMask({ motif }: { motif: Motif }) {
  const [variant, setVariant] = useState<"tall" | "phone" | "wide">("phone");
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      setVariant(width < 320 ? "tall" : width < 460 ? "phone" : "wide");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const asset = `/icons/owner-artwork/ks-owner-art-${motif}-${variant}-v1.svg`;
  return <span ref={container} aria-hidden="true" className="pointer-events-none absolute inset-0">{motif === "none" ? null : <span data-owner-artwork aria-hidden="true" className="absolute inset-0 bg-[var(--owner-hero-ink)]" style={{ maskImage: `url("${asset}")`, maskMode: "alpha", maskPosition: "right center", maskSize: "cover", maskRepeat: "no-repeat" }} />}</span>;
}
