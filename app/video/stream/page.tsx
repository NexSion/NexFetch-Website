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

function formatDuration(seconds?: string) {
  const s = Number(seconds);
  if (!s || Number.isNaN(s)) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function formatSize(bytes?: string) {
  const b = Number(bytes);
  if (!b || Number.isNaN(b)) return null;
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = b / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

function sourceDomain(url?: string) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
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
  const title = payload?.title ? decodeURIComponent(payload.title) : "NexFetch stream";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(payload?.url ?? null);
  const [status, setStatus] = useState<"checking" | "blocked" | "ready" | "error">("checking");
  const [message, setMessage] = useState<string>("Checking your daily stream limit...");
  const [isPlaying, setIsPlaying] = useState(false);

  // 1. Enforce the daily stream quota, then resolve a playable src.
  useEffect(() => {
    let bridge: ExtensionBridge | null = null;

    async function run() {
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
          setMessage(
            `Daily stream limit reached (${json.data.limit}/day on the free plan). Upgrade for unlimited streaming.`
          );
          return;
        }
      } catch {
        // fail open — don't let a limit-check hiccup block playback
      }

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

  // 2. Attach the resolved src to the <video> element. Plain HTML5 video
  // can't play .m3u8 (HLS) natively outside Safari, so for HLS sources we
  // hand it to hls.js and let that feed the MediaSource buffer instead.
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
            // Safari: native HLS support, no library needed.
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
        console.error("stream attach failed", err);
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

  const meta = [
    formatDuration(payload?.duration),
    payload?.quality,
    formatSize(payload?.size),
    payload?.stream_type === "dash" ? "DASH" : "HLS",
    sourceDomain(payload?.source_url)
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="overflow-hidden rounded-lg border border-border bg-card glow-border">
        <div className="relative aspect-video w-full bg-black">
          {status === "ready" && src ? (
            <video
              ref={videoRef}
              controls
              autoPlay
              poster={payload?.thumbnail ?? undefined}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => {
                const err = videoRef.current?.error;
                // eslint-disable-next-line no-console
                console.error("video element error", err);
                setStatus("error");
                setMessage("Playback failed. The video link may have expired.");
              }}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
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

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border p-5">
          <div>
            <h1 className="font-display text-lg font-medium text-foreground">{title}</h1>
            {meta.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {meta.map((m) => (
                  <span
                    key={m}
                    className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>

          {payload?.source_url && (
            <a
              href={payload.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              Open source
            </a>
          )}
        </div>
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
