"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ExtensionBridge, type VideoLinkData } from "@/lib/bridge";
import { formatBytes, formatDuration } from "@/lib/format";
import GlassCard from "@/components/GlassCard";

// Route: /video/cast/[id] — the cast SOURCE page. The Chromecast
// session itself is started from the extension popup via the Cast
// SDK; this page's job is enforcing the daily cast quota and giving
// the receiver a URL that actually plays (same HLS-in-browser fix as
// the stream page — a raw .m3u8 src fails silently in a plain <video>
// tag in Chrome).
type LimitState = "checking" | "allowed" | "blocked";
type ResolveState = "resolving" | "ready" | "error";

function isHlsLike(data: VideoLinkData | null): boolean {
  if (!data) return false;
  const ext = (data.extension ?? "").toLowerCase();
  return ext === "m3u8" || ext === "mpd" || data.url.includes(".m3u8") || data.url.includes(".mpd");
}

export default function CastPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const tabId = search.get("tid");
  const fallback: VideoLinkData | null = search.get("url")
    ? {
        url: search.get("url")!,
        title: search.get("title") ?? undefined,
        thumbnail: search.get("thumbnail") ?? undefined,
        extension: search.get("extension") ?? undefined
      }
    : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  const [limitState, setLimitState] = useState<LimitState>("checking");
  const [limitMessage, setLimitMessage] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("resolving");
  const [resolveError, setResolveError] = useState("");
  const [videoData, setVideoData] = useState<VideoLinkData | null>(fallback);

  useEffect(() => {
    fetch("/api/streaming/check-cast-limit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.allowed === false) {
          setLimitState("blocked");
          setLimitMessage(`Daily cast limit reached (${json.limit}/day on the free plan).`);
        } else {
          setLimitState("allowed");
        }
      })
      .catch(() => setLimitState("allowed"));
  }, []);

  useEffect(() => {
    if (videoData) {
      setResolveState("ready");
      return;
    }
    if (!tabId) {
      setResolveState("error");
      setResolveError("No source tab id and no direct url.");
      return;
    }
    const bridge = new ExtensionBridge(tabId);
    bridge
      .getHlsVideoData(params.id)
      .then((data) => {
        if (!data) {
          setResolveState("error");
          setResolveError("Couldn't retrieve this video from the extension.");
          return;
        }
        setVideoData(data);
        setResolveState("ready");
      })
      .catch(() => {
        setResolveState("error");
        setResolveError("NexFetch extension not detected on this tab.");
      });
    return () => bridge.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, params.id]);

  useEffect(() => {
    if (resolveState !== "ready" || !videoData || !videoRef.current) return;
    const video = videoRef.current;

    (async () => {
      if (isHlsLike(videoData)) {
        const { default: Hls } = await import("hls.js");
        if (Hls.isSupported()) {
          const hls = new Hls({
            xhrSetup: (xhr) => {
              if (videoData.headers) {
                for (const [k, v] of Object.entries(videoData.headers)) {
                  try {
                    xhr.setRequestHeader(k, v);
                  } catch {}
                }
              }
            }
          });
          hlsRef.current = hls;
          hls.loadSource(videoData.url);
          hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = videoData.url;
        }
      } else {
        video.src = videoData.url;
      }
    })();

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [resolveState, videoData]);

  const chips = useMemo(() => {
    if (!videoData) return [];
    return [
      formatDuration(videoData.duration),
      videoData.quality ?? (videoData.height ? `${videoData.height}p` : null),
      formatBytes(videoData.size),
      (videoData.extension ?? (isHlsLike(videoData) ? "HLS" : null))?.toUpperCase()
    ].filter(Boolean) as string[];
  }, [videoData]);

  if (limitState === "checking" || resolveState === "resolving") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">
        {limitState === "checking" ? "Checking your daily cast limit…" : "Loading…"}
      </div>
    );
  }

  if (limitState === "blocked") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <GlassCard className="glow-border">
          <p className="text-white">{limitMessage}</p>
          <a href="/pricing" className="mt-6 inline-block rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white">
            View upgrade options
          </a>
        </GlassCard>
      </div>
    );
  }

  if (resolveState === "error" || !videoData) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">{resolveError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-white">{videoData.title ?? "NexFetch cast"}</h1>
      <p className="mt-2 text-sm text-white/50">
        This tab is the cast source — start casting from the NexFetch toolbar popup.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/60">
            {c}
          </span>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl glow-border bg-black">
        <video ref={videoRef} controls className="aspect-video w-full" />
      </div>
    </div>
  );
}
