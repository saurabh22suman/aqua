// Mock-only gate access — the hardware boundary.
//
// A gate device presents a credential. What it presents is either a PIN
// typed on a keypad or an RFID tag tapped on a reader, and in both
// cases the transport is out of scope for this lane: there is no
// hardware integration, no vendor protocol and no paid provider here.
//
// This module is the seam where that transport will plug in. The
// decision service never talks to hardware — it receives a GateReading
// and works from that. A real reader would implement GateReader and
// the service would not change.

export const GATE_READING_KINDS = ["pin", "rfid"] as const;
export type GateReadingKind = (typeof GATE_READING_KINDS)[number];

export type GateReading = {
  kind: GateReadingKind;
  /** The presented value. Never logged, never stored. */
  value: string;
};

export interface GateReader {
  /** null when nothing was presented (an idle reader). */
  read(): Promise<GateReading | null>;
}

// The only reader in this lane. It replays a scripted sequence of
// readings so a demo or a test can drive a gate without hardware.
export class MockGateReader implements GateReader {
  private readonly queue: GateReading[];

  constructor(readings: GateReading[] = []) {
    this.queue = [...readings];
  }

  async read(): Promise<GateReading | null> {
    return this.queue.shift() ?? null;
  }
}
