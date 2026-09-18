"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { decodeDataParam } from "@/lib/dataParam";
import { formatDuration } from "@/lib/format";
import GlassCard from "@/components/GlassCard";

// Route: /video/cast?data=<base64>&tid=<tabId>&dkey=<deviceKey>
// Confirmed from popup.js's ko(): note the field is `thumb`, not
// `thumbnail` (different from the /video/stream payload — the
// extension's own naming is inconsistent between the two, not a typo
// on this site's part).
interface CastPayload {
  url: string;
  audio_url?: string | null;
  source_url?: string | null;
  title?: string | null;
  thumb?: string | null;
  quality?: string | null;
  domain?: string | null;
  stream_type?: "dash";
}

function isM3u8(url: string) {
  return url.includes(".m3u8");
}

export default function CastPage() {
  const search = useSearchParams();
  const payload = useMemo(() => decodeDataParam<CastPayload>(search.get("data")), [search]);
  const dkey = search.get("dkey");

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  const [limitState, setLimitState] = useState<"checking" | "allowed" | "blocked">("checking");
  const [limitMessage, setLimitMessage] = useState("");
  const [playerError, setPlayerError] = useState("");

  useEffect(() => {
    fetch("/api/streaming/check-cast-limit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_key: dkey ?? crypto.randomUUID() })
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.allowed === false) {
          setLimitState("blocked");
          setLimitMessage(`Daily cast limit reached (${json.data.limit}/day on the free plan).`);
        } else {
          setLimitState("allowed");
        }
      })
      .catch(() => setLimitState("allowed"));
  }, [dkey]);

  useEffect(() => {
    if (limitState !== "allowed" || !payload || !videoRef.current) return;
    const video = videoRef.current;
    const current = payload;

    if (current.stream_type === "dash") {
      setPlayerError("DASH (.mpd) casting isn't implemented yet.");
      return;
    }

    let cancelled = false;

    async function attach() {
      try {
        const { resolvePlayableUrl } = await import("@/lib/streamProxy");
        if (isM3u8(current.url)) {
          const { default: Hls } = await import("hls.js");
          if (cancelled) return;
          const playUrl = await resolvePlayableUrl(current);
          if (cancelled) return;
          if (Hls.isSupported()) {
            const hls = new Hls();
            hlsRef.current = hls;
            hls.loadSource(playUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              // eslint-disable-next-line no-console
              console.error("hls.js error", data);
              if (data.fatal) setPlayerError(`Playback failed (${data.details}) — the stream link may have expired.`);
            });
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = playUrl;
          } else {
            setPlayerError("This browser can't play HLS streams.");
          }
        } else {
          const playUrl = await resolvePlayableUrl(current);
          if (cancelled) return;
          video.src = playUrl;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("cast attach failed", err);
        if (!cancelled) setPlayerError("Couldn't start casting. Please try again.");
      }
    }

    attach();
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [limitState, payload]);

  const chips = useMemo(() => {
    if (!payload) return [];
    return [payload.quality, payload.stream_type === "dash" ? "DASH" : isM3u8(payload.url) ? "HLS" : null, payload.domain].filter(
      Boolean
    ) as string[];
  }, [payload]);

  if (limitState === "checking") {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">Checking your daily cast limit…</div>;
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

  if (!payload) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">No video data in the link.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-white">{payload.title ?? "NexFetch cast"}</h1>
      <p className="mt-2 text-sm text-white/50">This tab is the cast source — start casting from the NexFetch toolbar popup.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/60">
            {c}
          </span>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl glow-border bg-black">
        {playerError ? (
          <div className="flex aspect-video w-full items-center justify-center px-8 text-center text-white/60">{playerError}</div>
        ) : (
          <video ref={videoRef} controls className="aspect-video w-full" />
        )}
      </div>
    </div>
  );
}
