"use client";

import { useEffect, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Camera, Flashlight, ScanLine, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

const supportedFormats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
] as const;

type ScannerStatus = "idle" | "starting" | "scanning";

export function BarcodeScanner({
  onDetected,
  disabled = false,
}: {
  onDetected: (value: string) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectorFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const active = status === "scanning";
  const engaged = status !== "idle";

  function isSupportedJan(value: string) {
    return /^\d{8,14}$/.test(value);
  }

  function handleDetected(rawValue: string) {
    if (!isSupportedJan(rawValue)) {
      return;
    }

    navigator.vibrate?.(50);
    onDetected(rawValue);
    stop();
  }

  async function buildVideoConstraints() {
    const constraints: MediaTrackConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };

    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const backCamera = devices.find((device) =>
        /back|rear|environment|後|背面/i.test(device.label),
      );

      if (backCamera?.deviceId) {
        constraints.deviceId = { ideal: backCamera.deviceId };
      }
    } catch {
      return { video: constraints, audio: false };
    }

    return { video: constraints, audio: false };
  }

  async function initializeTorchState(stream: MediaStream) {
    mediaStreamRef.current = stream;
    const track = stream.getVideoTracks()[0] ?? null;
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;

    setTorchSupported(Boolean(capabilities?.torch));
    setTorchEnabled(false);
  }

  async function startWithBarcodeDetector(BarcodeDetectorCtor: new (options?: {
    formats?: string[];
  }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> }) {
    const stream = await navigator.mediaDevices.getUserMedia(await buildVideoConstraints());

    if (!videoRef.current) {
      throw new Error("VIDEO_ELEMENT_MISSING");
    }

    videoRef.current.srcObject = stream;
    await videoRef.current.play();
    await initializeTorchState(stream);

    const detector = new BarcodeDetectorCtor({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e"],
    });

    const scanFrame = async () => {
      if (!videoRef.current) {
        return;
      }

      try {
        if (videoRef.current.readyState >= 2) {
          const detected = await detector.detect(videoRef.current);
          const value = detected[0]?.rawValue;

          if (value) {
            handleDetected(value);
            return;
          }
        }
      } catch {
        setError("バーコードの読取に失敗しました。");
      }

      detectorFrameRef.current = window.requestAnimationFrame(() => {
        void scanFrame();
      });
    };

    detectorFrameRef.current = window.requestAnimationFrame(() => {
      void scanFrame();
    });
  }

  async function startWithZxing() {
    if (!videoRef.current) {
      throw new Error("VIDEO_ELEMENT_MISSING");
    }

    const reader = new BrowserMultiFormatReader();
    reader.possibleFormats = [...supportedFormats];
    readerRef.current = reader;

    controlsRef.current = await reader.decodeFromConstraints(
      await buildVideoConstraints(),
      videoRef.current,
      (result, err) => {
        if (result) {
          handleDetected(result.getText());
          return;
        }

        if (err && err.name !== "NotFoundException") {
          setError("バーコードの読取に失敗しました。");
        }
      },
    );

    const stream = videoRef.current?.srcObject;

    if (stream instanceof MediaStream) {
      await initializeTorchState(stream);
    }
  }

  async function start() {
    if (disabled || engaged) {
      return;
    }

    setError(null);
    setStatus("starting");

    try {
      const BarcodeDetectorCtor = (
        globalThis as unknown as {
          BarcodeDetector?: new (options?: {
            formats?: string[];
          }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> };
        }
      ).BarcodeDetector;

      if (BarcodeDetectorCtor) {
        await startWithBarcodeDetector(BarcodeDetectorCtor);
        setStatus("scanning");
        return;
      }

      await startWithZxing();
      setStatus("scanning");
    } catch {
      try {
        stop();
        setStatus("starting");
        await startWithZxing();
        setStatus("scanning");
      } catch {
        setError("カメラを開始できませんでした。Safari の権限設定を確認してください。");
        stop();
      }
    }
  }

  function stop() {
    if (detectorFrameRef.current !== null) {
      window.cancelAnimationFrame(detectorFrameRef.current);
      detectorFrameRef.current = null;
    }

    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTorchSupported(false);
    setTorchEnabled(false);
    setStatus("idle");
  }

  async function toggleTorch() {
    if (disabled) {
      return;
    }

    const stream = videoRef.current?.srcObject;
    const track =
      stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;

    if (!track?.applyConstraints) {
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchEnabled } as MediaTrackConstraintSet],
      });
      setTorchEnabled((current) => !current);
    } catch {
      setError("ライト切替に失敗しました。");
    }
  }

  useEffect(() => stop, []);

  useEffect(() => {
    if (disabled && engaged) {
      stop();
    }
  }, [disabled, engaged]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-white/70 bg-slate-950">
        <video ref={videoRef} className="aspect-[3/4] w-full object-cover" muted playsInline />
      </div>
      <div className="flex gap-3">
        {engaged ? (
          <Button className="flex-1" variant="danger" onClick={stop}>
            <StopCircle className="mr-2 h-4 w-4" />
            スキャン停止
          </Button>
        ) : (
          <Button className="flex-1" disabled={disabled} onClick={start}>
            <ScanLine className="mr-2 h-4 w-4" />
            カメラで読む
          </Button>
        )}
        <Button
          className="w-14"
          disabled={disabled || engaged}
          size="icon"
          variant="secondary"
          onClick={start}
        >
          <Camera className="h-5 w-5" />
        </Button>
        <Button
          className="w-14"
          disabled={disabled || !active || !torchSupported}
          size="icon"
          variant="secondary"
          onClick={toggleTorch}
        >
          <Flashlight className={`h-5 w-5 ${torchEnabled ? "text-amber-500" : ""}`} />
        </Button>
      </div>
      {status === "starting" ? (
        <p className="text-xs text-slate-500">
          カメラ権限を確認し、背面カメラで JAN を探しています。
        </p>
      ) : null}
      {active ? (
        <p className="text-xs text-slate-500">
          {torchSupported
            ? "背面カメラで読取中です。必要ならライトを点灯できます。"
            : "背面カメラで読取中です。JAN が枠中央に収まるよう近づけてください。"}
        </p>
      ) : null}
      {disabled ? (
        <p className="text-xs text-slate-500">オフライン中はスキャン登録を停止しています。</p>
      ) : null}
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
