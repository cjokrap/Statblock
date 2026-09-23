"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "../log.module.css";

// Reads a product barcode with the phone's back camera (ZXing, which also
// works in iPhone Safari, where the browser's BarcodeDetector doesn't
// exist), or takes one typed in. Either way it opens /log/barcode/<code>.
export function Scanner({ meal }: { meal: string }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "blocked" | "none">("starting");
  const [typed, setTyped] = useState("");
  const done = useRef(false);

  const open = (code: string) => {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 8 || done.current) return;
    done.current = true;
    router.push(`/log/barcode/${digits}?meal=${meal}`);
  };

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setStatus("none");
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video.current!,
          (result) => {
            if (result) {
              controls.stop();
              open(result.getText());
            }
          },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
        else setStatus("scanning");
      } catch {
        if (!cancelled) setStatus("blocked");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
    // Starts once; `open` only reads refs and props that don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className={styles.camera}>
        <video ref={video} muted playsInline className={styles.video} aria-label="Camera view" />
        <div className={styles.aim} aria-hidden="true" />
      </div>
      <p className={styles.hint} role="status">
        {status === "starting" && "Starting the camera…"}
        {status === "scanning" && "Point the camera at the barcode. It reads it on its own."}
        {status === "blocked" &&
          "The camera isn't available. Allow camera access for this site in your browser settings, or type the number below."}
        {status === "none" && "This browser can't use the camera here. Type the number below."}
      </p>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          open(typed);
        }}
      >
        <label htmlFor="barcode" className="visually-hidden">
          Barcode number
        </label>
        <input id="barcode" inputMode="numeric" autoComplete="off" placeholder="Or type the barcode number"
          value={typed} onChange={(e) => setTyped(e.target.value)} className={styles.input} />
        <button type="submit" className={styles.go}>
          Look up
        </button>
      </form>
    </>
  );
}
