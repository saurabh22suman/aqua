"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// Camera lifecycle for the booking-entry scanner, kept out of the scanner's
// presentational code so the scanner stays under the house's module-size
// guideline and the permission logic has one owner.
//
// Rules this hook enforces:
//   * permission is requested only by an explicit `startCamera()` call;
//   * a pending request is invalidated by stop/unmount, so the camera cannot
//     switch on after the staff member moved on;
//   * tracks are stopped on stop, on scan, on unsupported detection, and on
//     unmount;
//   * frames stay local. Nothing is uploaded, stored or logged;
//   * QR decoding uses the browser's BarcodeDetector when it exists. If it does
//     not, the hook says so and leaves the manual field as the fallback.

export type BookingEntryCameraState = "idle" | "starting" | "live";

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

export type BookingEntryCamera = {
  camera: BookingEntryCameraState;
  cameraError: string | null;
  cameraNote: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  clearMessages: () => void;
};

function makeDetector(): BarcodeDetectorLike | null {
  const ctor = (
    globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function cameraErrorMessage(error: unknown): string {
  // DOMException is not always `instanceof Error` in every runtime, so read
  // the name structurally. No error message is ever shown.
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Enter the pass token below.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Enter the pass token below.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use. Enter the pass token below.";
  }
  return "The camera could not start. Enter the pass token below.";
}

export function useBookingEntryCamera(
  onDetected: (raw: string) => void,
): BookingEntryCamera {
  const [camera, setCamera] = useState<BookingEntryCameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorTimerRef = useRef<number | null>(null);
  const cameraRequestRef = useRef(0);
  const unmountStopTimerRef = useRef<number | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  function releaseCamera() {
    if (detectorTimerRef.current !== null) {
      window.clearInterval(detectorTimerRef.current);
      detectorTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopCamera() {
    // Invalidate a pending getUserMedia result: a manual submission or a
    // toggle must not let the camera switch on after the fact.
    cameraRequestRef.current += 1;
    releaseCamera();
    setCamera("idle");
  }

  function clearMessages() {
    setCameraError(null);
    setCameraNote(null);
  }

  async function startCamera() {
    setCameraError(null);
    setCameraNote(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "This browser cannot open a camera. Enter the pass token below.",
      );
      return;
    }
    const request = cameraRequestRef.current + 1;
    cameraRequestRef.current = request;
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCamera("live");
    } catch (error) {
      if (request !== cameraRequestRef.current) return;
      setCamera("idle");
      setCameraError(cameraErrorMessage(error));
    }
  }

  useEffect(() => {
    // A StrictMode development remount runs cleanup then setup again. Defer
    // the track stop by one macrotask and cancel it in setup, so the remount
    // keeps the live stream; a real unmount still stops every track.
    if (unmountStopTimerRef.current !== null) {
      window.clearTimeout(unmountStopTimerRef.current);
      unmountStopTimerRef.current = null;
    }
    return () => {
      cameraRequestRef.current += 1;
      if (detectorTimerRef.current !== null) {
        window.clearInterval(detectorTimerRef.current);
      }
      const stream = streamRef.current;
      unmountStopTimerRef.current = window.setTimeout(() => {
        stream?.getTracks().forEach((track) => track.stop());
        unmountStopTimerRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (camera !== "live") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      // Autoplay can be blocked; the manual field remains the fallback.
    });

    const detector = makeDetector();
    if (!detector) {
      setCameraNote(
        "This browser cannot read QR codes here. Enter the pass token below.",
      );
      if (detectorTimerRef.current !== null) {
        window.clearInterval(detectorTimerRef.current);
        detectorTimerRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      video.srcObject = null;
      setCamera("idle");
      return;
    }

    let cancelled = false;
    detectorTimerRef.current = window.setInterval(async () => {
      const currentVideo = videoRef.current;
      if (cancelled || !currentVideo || currentVideo.readyState < 2) {
        return;
      }
      try {
        const codes = await detector.detect(currentVideo);
        const raw = codes[0]?.rawValue?.trim();
        if (!raw || cancelled) return;
        cancelled = true;
        if (detectorTimerRef.current !== null) {
          window.clearInterval(detectorTimerRef.current);
          detectorTimerRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        currentVideo.srcObject = null;
        setCamera("idle");
        onDetectedRef.current(raw);
      } catch {
        // Detection is best-effort. The manual field is always available.
      }
    }, 400);

    return () => {
      cancelled = true;
      if (detectorTimerRef.current !== null) {
        window.clearInterval(detectorTimerRef.current);
        detectorTimerRef.current = null;
      }
    };
  }, [camera]);

  return {
    camera,
    cameraError,
    cameraNote,
    videoRef,
    startCamera,
    stopCamera,
    clearMessages,
  };
}
