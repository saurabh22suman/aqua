"use client";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_MOTIF, readArtwork, writeArtwork, type ArtworkIdentity, type Motif } from "./preference";
const options: { value: Motif; label: string }[] = [
  { value: "swimming", label: "Swimming" }, { value: "badminton", label: "Badminton" },
  { value: "football", label: "Football" }, { value: "tennis", label: "Tennis" },
  { value: "cricket", label: "Cricket" }, { value: "yoga-fitness", label: "Yoga/Fitness" },
  { value: "multi-sport", label: "Multi-sport" }, { value: "none", label: "None" },
];
export function ArtworkChooser({ identity, renderArtwork }: { identity: ArtworkIdentity; renderArtwork: (motif: Motif) => ReactNode }) {
  const [motif, setMotif] = useState<Motif>(DEFAULT_MOTIF);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setMotif(readArtwork(identity)); }, [identity]);
  return <fieldset className="rounded-card border border-line bg-paper p-4">
    <legend className="font-display text-lg font-semibold">Collection card artwork</legend>
    <p className="mb-3 text-sm text-ink-2">Personal display preference on this device.</p>
    <div data-testid="artwork-preview" aria-label="Artwork preview" className="relative mb-4 aspect-[3/1] w-full max-w-[496px] overflow-hidden rounded-card bg-[var(--owner-hero)] p-5 text-[var(--owner-hero-ink)]">
      {renderArtwork(motif)}
      <p className="relative font-display font-semibold">Collections artwork preview</p>
      <p className="relative mt-8 text-sm">Your selected artwork appears here.</p>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {options.map(option => <label key={option.value} className="flex min-h-11 items-center gap-2 rounded-ctl border border-line px-3 text-sm text-ink"><input type="radio" name="owner-artwork" value={option.value} checked={motif === option.value} onChange={() => { setMotif(option.value); setFailed(!writeArtwork(identity, option.value)); }} />{option.label}</label>)}
    </div>
    {failed ? <p role="status" className="mt-3 text-sm text-ink-2">This device could not save your choice. Try again when storage is available.</p> : null}
  </fieldset>;
}
