export const MOTIFS = ["swimming", "badminton", "football", "tennis", "cricket", "yoga-fitness", "multi-sport", "none"] as const;
export type Motif = (typeof MOTIFS)[number];
export type ArtworkIdentity = { tenantId: string; userId: string };
export const DEFAULT_MOTIF: Motif = "multi-sport";
export function artworkKey(identity: ArtworkIdentity): string {
  return `aqua:owner-art:${encodeURIComponent(identity.tenantId)}:${encodeURIComponent(identity.userId)}`;
}
export function readArtwork(identity: ArtworkIdentity): Motif {
  try {
    const value = window.localStorage.getItem(artworkKey(identity));
    return MOTIFS.find(motif => motif === value) ?? DEFAULT_MOTIF;
  } catch { return DEFAULT_MOTIF; }
}
export function writeArtwork(identity: ArtworkIdentity, value: Motif): boolean {
  try { window.localStorage.setItem(artworkKey(identity), value); return true; } catch { return false; }
}
