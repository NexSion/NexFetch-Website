"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ExtensionBridge } from "@/lib/bridge";

// Route matched by manifest.json's content_scripts entry for bridge.js:
//   *://nexfetch.vercel.app/video/stream/*
// [id] is the video's uuid (crypto.randomUUID(), assigned by the
// extension when it first detected the stream). `tid` in the query
// string is the originating tab id, used to open the matching
// BroadcastChannel the injected bridge.js is listening on.
export default function StreamPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const tabId = search.get("tid");
  const directUrl = search.get("url");
  const title = search.get("title") ?? "NexFetch stream";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(directUrl);
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
          body: JSON.stringify({})
        });
        const json = await res.json();
        if (json.success && json.allowed === false) {
          setStatus("blocked");
          setMessage(`Daily stream limit reached (${json.limit}/day on the free plan). Upgrade for unlimited streaming.`);
          return;
        }
      } catch {
        // If the limit check itself fails, don't hard-block playback —
        // fail open rather than breaking the feature for everyone.
      }

      // 2. If we don't already have a direct URL, ask the extension
      //    (via the bridge it injected on this page) for the resolved
      //    HLS/DASH data behind this uuid.
      if (!directUrl && tabId) {
        bridge = new ExtensionBridge(tabId);
        try {
          const data = (await bridge.getHlsVideoData(params.id)) as { url?: string } | null;
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
      }

      setStatus("ready");
    }

    run();
    return () => bridge?.close();
  }, [directUrl, params.id, tabId]);

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
        <a
          href="/account"
          className="mt-6 inline-block rounded-full bg-nex-gradient px-5 py-2.5 text-sm font-medium text-white"
        >
          View upgrade options
        </a>
      )}
    </div>
  );
}
