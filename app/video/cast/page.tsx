"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExtensionBridge } from "@/lib/bridge";

type CastData = {
  url?: string;
  source_url?: string;
  title?: string;
  thumb?: string | null;
  quality?: string | null;
  domain?: string | null;
  audio_url?: string | null;
  stream_type?: "dash";
};

function decodeData(raw: string | null): CastData | null {
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export default function CastPage() {
  const search = useSearchParams();
  const tabId = search.get("tid");
  const videoId = search.get("id");
  const deviceKey = search.get("dkey");
  const payload = decodeData(search.get("data"));
  const title = payload?.title ? decodeURIComponent(payload.title) : "NexFetch cast";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(payload?.url ?? null);
  const [status, setStatus] = useState<"checking" | "blocked" | "ready" | "error">("checking");
  const [message, setMessage] = useState("Checking your daily cast limit...");

  useEffect(() => {
    let bridge: ExtensionBridge | null = null;

    async function run() {
      try {
        const res = await fetch("/api/streaming/check-cast-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(deviceKey ? { device_key: deviceKey } : {})
        });
        const json = await res.json();
        if (json.success && json.data?.allowed === false) {
          setStatus("blocked");
          setMessage(
            `Daily cast limit reached (${json.data.limit}/day on the free plan). Upgrade for unlimited casting.`
          );
          return;
        }
      } catch {
        // fail open
      }

      if (!src && videoId && tabId) {
        bridge = new ExtensionBridge(tabId);
        try {
          const data = (await bridge.getHlsVideoData(videoId)) as { url?: string } | null;
          if (data?.url) {
            setSrc(data.url);
          } else {
            setStatus("error");
            setMessage("Couldn't retrieve this video from the extension.");
            return;
          }
        } catch {
          setStatus("error");
          setMessage("NexFetch extension not detected on this tab.");
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

  useEffect(() => {
    if (status !== "ready" || !src || !videoRef.current) return;
    const video = videoRef.current;
    const isHls = payload?.stream_type !== "dash" && /\.m3u8(\?|$)/i.test(src);

    let hls: import("hls.js").default | null = null;
    let cancelled = false;

    async function attach() {
      try {
        if (isHls) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src as string;
            return;
          }
          const { default: Hls } = await import("hls.js");
          if (cancelled) return;
          if (Hls.isSupported()) {
            hls = new Hls();
            hls.on(Hls.Events.ERROR, (_event, data) => {
              // eslint-disable-next-line no-console
              console.error("hls.js error", data);
              if (data.fatal && !cancelled) {
                setStatus("error");
                setMessage(
                  `Couldn't load this stream (${data.details}). The link may have expired — try reopening it from the extension.`
                );
              }
            });
            hls.loadSource(src as string);
            hls.attachMedia(video);
          } else {
            setStatus("error");
            setMessage("This browser can't play HLS streams. Try Chrome, Edge, Firefox, or Safari.");
          }
        } else {
          video.src = src as string;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("cast attach failed", err);
        if (!cancelled) {
          setStatus("error");
          setMessage("Couldn't start playback. Please try again.");
        }
      }
    }

    attach();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [status, src, payload?.stream_type]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This tab is the cast source — start casting from the NexFetch toolbar popup.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-border bg-card glow-border">
        {status === "ready" && src ? (
          <video
            ref={videoRef}
            controls
            poster={payload?.thumb ?? undefined}
            onError={() => {
              const err = videoRef.current?.error;
              // eslint-disable-next-line no-console
              console.error("video element error", err);
              setStatus("error");
              setMessage("Playback failed. The video link may have expired.");
            }}
            className="mx-auto aspect-video w-full"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {status === "checking" ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-primary" />
                {message}
              </span>
            ) : (
              message
            )}
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
