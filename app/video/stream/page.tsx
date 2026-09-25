"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { decodeDataParam } from "@/lib/dataParam";
import { downloadHls } from "@/lib/hlsDownload";
import { refererFor } from "@/lib/streamProxy";
import { formatBytes, formatDuration } from "@/lib/format";
import GlassCard from "@/components/GlassCard";

// Route: /video/stream?data=<base64>&tid=<tabId>&id=<uuid>&dkey=<deviceKey>
//
// Login is required to reach this page's content at all (see
// middleware.ts) — the old anonymous/device-only free tier is
// retired. `id`/`dkey` still ride along for the BroadcastChannel
// bridge and the device-claim flow, `tid` is unused now that
// downloads no longer go through the extension bridge (see
// lib/hlsDownload.ts's file header for why).
interface StreamPayload {
  url: string;
  source_url?: string | null;
  title?: string | null;
  thumbnail?: string | null;
  duration?: string | null; // seconds, as a string
  quality?: string | null;
  size?: string | null; // bytes, as a string
  audio_url?: string | null;
  stream_type?: "dash";
}

type LimitState = "checking" | "allowed" | "blocked" | "login_required";
type DownloadState = "idle" | "downloading" | "done" | "error";

const AUTOSTART_KEY = "nexfetch:autostart";
const AUTOSAVE_KEY = "nexfetch:autosave";

function isM3u8(url: string) {
  return url.includes(".m3u8");
}

export default function StreamPage() {
  const search = useSearchParams();
  const payload = useMemo(() => decodeDataParam<StreamPayload>(search.get("data")), [search]);
  const uuid = search.get("id");
  const dkey = search.get("dkey");

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  const [limitState, setLimitState] = useState<LimitState>("checking");
  const [limitMessage, setLimitMessage] = useState("");
  const [playerError, setPlayerError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 3>(1);
  const [autoStart, setAutoStart] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const [filename, setFilename] = useState(payload?.title ?? "");
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    setAutoStart(localStorage.getItem(AUTOSTART_KEY) === "1");
    setAutoSave(localStorage.getItem(AUTOSAVE_KEY) === "1");
  }, []);

  function toggleAutoStart() {
    setAutoStart((v) => {
      localStorage.setItem(AUTOSTART_KEY, v ? "0" : "1");
      return !v;
    });
  }
  function toggleAutoSave() {
    setAutoSave((v) => {
      localStorage.setItem(AUTOSAVE_KEY, v ? "0" : "1");
      return !v;
    });
  }

  // ---- daily 10GB free-plan data cap (login required) ----
  useEffect(() => {
    fetch("/api/streaming/check-limit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_key: dkey ?? undefined })
    })
      .then(async (r) => {
        if (r.status === 401) {
          setLimitState("login_required");
          return;
        }
        const json = await r.json();
        if (json.success && json.data?.allowed === false) {
          setLimitState("blocked");
          setLimitMessage(`Daily free-plan limit reached (${formatBytes(json.data.limit)} used today).`);
        } else {
          setLimitState("allowed");
        }
      })
      .catch(() => setLimitState("allowed"));
  }, [dkey]);

  useEffect(() => {
    if (!autoSave || autoSaved || !payload) return;
    fetch("/api/videos", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hash: uuid ?? payload.url,
        title: payload.title ?? undefined,
        link: payload.source_url ?? undefined,
        thumbnail: payload.thumbnail ?? undefined
      })
    })
      .then(() => setAutoSaved(true))
      .catch(() => {});
  }, [autoSave, autoSaved, payload, uuid]);

  function startPlayback() {
    if (!payload) return;
    setIsPlaying(true);
  }

  useEffect(() => {
    if (!isPlaying || !payload || !videoRef.current) return;
    const video = videoRef.current;
    const current = payload;

    if (current.stream_type === "dash") {
      setPlayerError("DASH (.mpd) playback isn't implemented yet — this needs a DASH player (e.g. dash.js), not hls.js.");
      return;
    }

    let cancelled = false;

    async function attach() {
      if (isM3u8(current.url)) {
        const [{ default: Hls }, { resolvePlayableUrl }] = await Promise.all([
          import("hls.js"),
          import("@/lib/streamProxy")
        ]);
        if (cancelled) return;
        const playUrl = await resolvePlayableUrl(current);
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls();
          hlsRef.current = hls;
          hls.loadSource(playUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            // eslint-disable-next-line no-console
            console.error("hls.js error", data);
            if (data.fatal) setPlayerError(`Playback failed (${data.details}) — the stream link may have expired.`);
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playUrl;
          video.play().catch(() => {});
        } else {
          setPlayerError("This browser can't play HLS streams.");
        }
      } else {
        const { resolvePlayableUrl } = await import("@/lib/streamProxy");
        const playUrl = await resolvePlayableUrl(current);
        if (cancelled) return;
        video.src = playUrl;
        video.play().catch(() => {});
      }
    }

    attach();
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [isPlaying, payload]);

  useEffect(() => {
    if (autoStart && limitState === "allowed" && payload && !isPlaying) startPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, limitState, payload]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // ---- download ----
  // Fully browser-side (see lib/hlsDownload.ts) — no extension needed.
  // After the blob is built, its size is reported to
  // /api/streaming/report-bytes so tomorrow's check-limit call reflects
  // today's usage against the 10GB free-plan cap.
  async function handleDownload() {
    if (!payload) return;
    setDownloadState("downloading");
    setDownloadProgress(0);
    setDownloadError("");
    const finalName = (filename || payload.title || "nexfetch-video").trim();

    try {
      if (payload.stream_type === "dash") {
        throw new Error("DASH_NOT_SUPPORTED");
      }

      if (isM3u8(payload.url)) {
        const { blob, container } = await downloadHls(payload.url, {
          onProgress: setDownloadProgress,
          refererUrl: refererFor(payload)
        });

        fetch("/api/streaming/report-bytes", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bytes: blob.size })
        }).catch(() => {});

        const ext = container === "mp4" ? "mp4" : "ts";
        const blobUrl = URL.createObjectURL(blob);
        const fullName = `${finalName}.${ext}`;
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fullName;
        a.click();
      } else {
        const fullName = `${finalName}.mp4`;
        const { resolvePlayableUrl } = await import("@/lib/streamProxy");
        const fileUrl = await resolvePlayableUrl(payload);
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = fullName;
        a.click();
      }
      setDownloadState("done");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("download failed", err);
      setDownloadState("error");

      const msg = err instanceof Error ? err.message : "";
      const fetchStatus = /^(PLAYLIST_FETCH_FAILED|SEGMENT_FETCH_FAILED)_(\d+)$/.exec(msg);

      setDownloadError(
        msg === "ENCRYPTED_STREAM_UNSUPPORTED"
          ? "This stream is encrypted (DRM) — NexFetch can't download it."
          : msg === "DASH_NOT_SUPPORTED"
            ? "DASH downloads aren't implemented yet."
            : msg === "NO_VARIANTS_FOUND" || msg === "NO_SEGMENTS_FOUND"
              ? "Couldn't find a downloadable stream in this playlist."
              : fetchStatus
                ? `Download failed — the source returned HTTP ${fetchStatus[2]} while fetching ${
                    fetchStatus[1] === "PLAYLIST_FETCH_FAILED" ? "the playlist" : "a video segment"
                  }. The link may have expired — try reopening this from the extension.`
                : `Download failed — the source may block cross-origin access from this page.${
                    msg ? ` (${msg})` : ""
                  }`
      );
    }
  }

  const chips = useMemo(() => {
    if (!payload) return [];
    return [
      formatDuration(payload.duration ? Number(payload.duration) : undefined),
      payload.quality,
      formatBytes(payload.size ? Number(payload.size) : undefined),
      payload.stream_type === "dash" ? "DASH" : isM3u8(payload.url) ? "HLS" : null,
      payload.source_url
        ? (() => {
            try {
              return new URL(payload.source_url!).hostname;
            } catch {
              return null;
            }
          })()
        : null
    ].filter(Boolean) as string[];
  }, [payload]);

  if (limitState === "checking") {
    return <div className="mx-auto max-w-4xl px-6 py-16 text-center text-white/60">Checking your daily limit…</div>;
  }

  if (limitState === "login_required") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <GlassCard className="glow-border">
          <p className="text-white">Log in to stream or download this video.</p>
          <a
            href={`/login${dkey ? `?dkey=${encodeURIComponent(dkey)}` : ""}`}
            className="mt-6 inline-block rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white"
          >
            Log in with Google
          </a>
        </GlassCard>
      </div>
    );
  }

  if (limitState === "blocked") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <GlassCard className="glow-border">
          <p className="text-white">{limitMessage}</p>
          <p className="mt-3 text-sm text-white/50">Resets at midnight UTC, or upgrade to Premium for no cap.</p>
        </GlassCard>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">
        No video data in the link — open this from the NexFetch popup.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl text-white">{payload.title ?? "NexFetch stream"}</h1>

      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/60">
            {c}
          </span>
        ))}
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl glow-border bg-black">
        {playerError ? (
          <div className="flex aspect-video w-full items-center justify-center px-8 text-center text-white/60">
            {playerError}
          </div>
        ) : !isPlaying ? (
          <button onClick={startPlayback} className="group relative flex aspect-video w-full items-center justify-center">
            {payload.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={payload.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            ) : null}
            <span className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-nex-gradient shadow-xl shadow-violet-deep/40 transition-transform group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        ) : (
          <video ref={videoRef} controls className="aspect-video w-full" />
        )}
      </div>

      {payload.source_url && (
        <a href={payload.source_url} target="_blank" className="mt-3 inline-block text-sm text-blue-glow hover:underline">
          Open source →
        </a>
      )}

      <GlassCard className="mt-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/50">Speed</span>
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s as 1 | 2 | 3)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  speed === s ? "bg-nex-gradient text-white" : "border border-white/10 text-white/60 hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={autoStart} onChange={toggleAutoStart} className="accent-violet-glow" />
            Auto-start
          </label>

          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={autoSave} onChange={toggleAutoSave} className="accent-violet-glow" />
            Auto-save
            {autoSave && autoSaved && <span className="text-xs text-green-400">saved ✓</span>}
          </label>
        </div>
      </GlassCard>

      <GlassCard className="mt-4">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="File name"
            className="flex-1 bg-transparent text-white outline-none"
          />
          <span className="text-sm text-white/40">.{isM3u8(payload.url) ? "mp4/ts" : "mp4"}</span>
        </div>

        <button
          onClick={handleDownload}
          disabled={downloadState === "downloading"}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-nex-gradient px-5 py-3 text-sm font-medium text-white shadow-lg shadow-violet-deep/30 disabled:opacity-60"
        >
          {downloadState === "downloading"
            ? `Downloading… ${Math.round(downloadProgress * 100)}%`
            : downloadState === "done"
              ? "Downloaded — start again"
              : "Start Download"}
        </button>

        {downloadState === "downloading" && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-nex-gradient transition-all" style={{ width: `${Math.round(downloadProgress * 100)}%` }} />
          </div>
        )}

        {downloadState === "error" && <p className="mt-3 text-sm text-red-400">{downloadError}</p>}
      </GlassCard>
    </div>
  );
}
