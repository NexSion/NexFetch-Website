"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExtensionBridge } from "@/lib/bridge";

type StreamData = {
  url?: string;
  source_url?: string;
  title?: string;
  thumbnail?: string | null;
  duration?: string;
  quality?: string;
  size?: string;
  audio_url?: string | null;
  stream_type?: "dash";
};

// Route hit by the extension as:
//   /video/stream?data=<base64 JSON>&tid=<tabId>&id=<uuid>&dkey=<deviceKey>
// `data` carries the resolved video info as base64-encoded JSON (see the
// extension's `ue()`/`mn()` helpers). `id` is the video's uuid, used only
// as a fallback lookup key if the bridge needs to re-ask the extension.
function decodeData(raw: string | null): StreamData | null {
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export default function StreamPage() {
  const search = useSearchParams();
  const tabId = search.get("tid");
  const videoId = search.get("id");
  const deviceKey = search.get("dkey");
  const payload = decodeData(search.get("data"));
  const title = payload?.title ?? "NexFetch stream";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(payload?.url ?? null);
  const [status, setStatus] = useState<"checking" | "blocked" | "ready" | "error">("checking");
  const [message, setMessage] = useState<string>("Checking your daily stream limit…");

  useEffect(() => {
    let bridge: ExtensionBridge | null = null;

    async function run() {
      // 1. Enforce the daily stream quota server-side before playing anything.
      try {
        const res = await fetch("/api/streaming/check-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(deviceKey ? { device_key: deviceKey } : {})
        });
        const json = await res.json();
        if (json.success && json.data?.allowed === false) {
          setStatus("blocked");
          setMessage(`Daily stream limit reached (${json.data.limit}/day on the free plan). Upgrade for unlimited streaming.`);
          return;
        }
      } catch {
        // If the limit check itself fails, don't hard-block playback —
        // fail open rather than breaking the feature for everyone.
      }

      // 2. If we don't already have a direct URL (data param missing/broken),
      //    ask the extension via the bridge for the resolved HLS/DASH data.
      if (!src && videoId && tabId) {
        bridge = new ExtensionBridge(tabId);
        try {
          const data = (await bridge.getHlsVideoData(videoId)) as { url?: string } | null;
          if (data?.url) {
            setSrc(data.url);
          } else {
            setStatus("error");
            setMessage("Couldn't retrieve this video from the extension. Try reopening it from the popup.");
            return;
          }
        } catch {
          setStatus("error");
          setMessage("NexFetch extension not detected on this tab. Install or enable it to stream this video.");
          return;
        }
      } else if (!src) {
        setStatus("error");
        setMessage("No video data found in this link.");
        return;
      }

      setStatus("ready");
    }

    run();
    return () => bridge?.close();
  }, [src, videoId, tabId, deviceKey]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="font-display text-2xl text-white">{decodeURIComponent(title)}</h1>

      <div className="mt-6 overflow-hidden rounded-2xl glow-border bg-black">
        {status === "ready" && src ? (
          <video ref={videoRef} src={src} controls autoPlay className="aspect-video w-full" />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center px-8 text-center text-white/60">
            {message}
          </div>
        )}
      </div>

      {status === "blocked" && (
        
          href="/account"
          className="mt-6 inline-block rounded-full bg-nex-gradient px-5 py-2.5 text-sm font-medium text-white"
        >
          View upgrade options
        </a>
      )}
    </div>
  );
}