"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Camera, Flashlight, ScanLine, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

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
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

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
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    if (!videoRef.current) {
      throw new Error("VIDEO_ELEMENT_MISSING");
    }

    videoRef.current.srcObject = stream;
    await videoRef.current.play();
    await initializeTorchState(stream);

    const detector = new BarcodeDetectorCtor({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
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
            navigator.vibrate?.(50);
            onDetected(value);
            stop();
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
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    controlsRef.current = await reader.decodeFromVideoDevice(
      undefined,
      videoRef.current!,
      (result, err) => {
        if (result) {
          navigator.vibrate?.(50);
          onDetected(result.getText());
          stop();
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
    if (disabled) {
      return;
    }

    setError(null);

    try {
      setActive(true);
      const BarcodeDetectorCtor = (
        globalThis as unknown as {
          BarcodeDetector?: new (options?: {
            formats?: string[];
          }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> };
        }
      ).BarcodeDetector;

      if (BarcodeDetectorCtor) {
        await startWithBarcodeDetector(BarcodeDetectorCtor);
        return;
      }

      await startWithZxing();
    } catch {
      try {
        stop();
        setActive(true);
        await startWithZxing();
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
    setActive(false);
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

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-white/70 bg-slate-950">
        <video ref={videoRef} className="aspect-[3/4] w-full object-cover" muted playsInline />
      </div>
      <div className="flex gap-3">
        {active ? (
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
        <Button className="w-14" disabled={disabled} size="icon" variant="secondary" onClick={start}>
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
      {active ? (
        <p className="text-xs text-slate-500">
          {torchSupported ? "ライト切替に対応しています。" : "この端末ではライト切替に未対応です。"}
        </p>
      ) : null}
      {disabled ? (
        <p className="text-xs text-slate-500">オフライン中はスキャン登録を停止しています。</p>
      ) : null}
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
