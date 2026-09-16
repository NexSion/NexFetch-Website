"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ExtensionBridge, type VideoLinkData } from "@/lib/bridge";
import { downloadHls } from "@/lib/hlsDownload";
import { formatBytes, formatDuration } from "@/lib/format";
import GlassCard from "@/components/GlassCard";

type LimitState = "checking" | "allowed" | "blocked";
type ResolveState = "resolving" | "ready" | "error";
type DownloadState = "idle" | "downloading" | "done" | "error";

const AUTOSTART_KEY = "nexfetch:autostart";
const AUTOSAVE_KEY = "nexfetch:autosave";

function isHlsLike(data: VideoLinkData | null): boolean {
  if (!data) return false;
  const ext = (data.extension ?? "").toLowerCase();
  return ext === "m3u8" || ext === "mpd" || data.url.includes(".m3u8") || data.url.includes(".mpd");
}

export default function StreamPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const tabId = search.get("tid");
  // Fallback fields let this page also work from a plain link (no
  // extension tab context) for quick testing: /video/stream/x?url=...
  const fallback: VideoLinkData | null = search.get("url")
    ? {
        url: search.get("url")!,
        title: search.get("title") ?? undefined,
        thumbnail: search.get("thumbnail") ?? undefined,
        extension: search.get("extension") ?? undefined,
        webpage_url: search.get("webpage_url") ?? undefined
      }
    : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  const [limitState, setLimitState] = useState<LimitState>("checking");
  const [limitMessage, setLimitMessage] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("resolving");
  const [resolveError, setResolveError] = useState("");
  const [videoData, setVideoData] = useState<VideoLinkData | null>(fallback);
  const [bridgeAvailable, setBridgeAvailable] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 3>(1);
  const [autoStart, setAutoStart] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const [filename, setFilename] = useState("");

  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState("");

  // ---- restore per-viewer prefs ----
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

  // ---- daily stream limit ----
  useEffect(() => {
    fetch("/api/streaming/check-limit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.allowed === false) {
          setLimitState("blocked");
          setLimitMessage(`Daily stream limit reached (${json.limit}/day on the free plan).`);
        } else {
          setLimitState("allowed");
        }
      })
      .catch(() => setLimitState("allowed")); // fail open
  }, []);

  // ---- resolve video data via the extension bridge ----
  useEffect(() => {
    if (videoData) {
      setResolveState("ready");
      return;
    }
    if (!tabId) {
      setResolveState("error");
      setResolveError("No source tab id and no direct url — open this from the NexFetch popup.");
      return;
    }

    const bridge = new ExtensionBridge(tabId);
    setBridgeAvailable(bridge.available);

    bridge
      .getHlsVideoData(params.id)
      .then((data) => {
        if (!data) {
          setResolveState("error");
          setResolveError("NexFetch couldn't find this video anymore — try reopening it from the popup.");
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

  // ---- filename default ----
  useEffect(() => {
    if (videoData?.title && !filename) setFilename(videoData.title);
  }, [videoData, filename]);

  // ---- auto-save to library once resolved ----
  useEffect(() => {
    if (!autoSave || autoSaved || !videoData || resolveState !== "ready") return;
    const hash = videoData.uuid ?? videoData.url;
    fetch("/api/videos", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: { ...videoData, hash } })
    })
      .then(() => setAutoSaved(true))
      .catch(() => {});
  }, [autoSave, autoSaved, videoData, resolveState]);

  // ---- attach player (hls.js for m3u8/mpd, native src otherwise) ----
  async function startPlayback() {
    if (!videoData || !videoRef.current) return;
    setIsPlaying(true);
    const video = videoRef.current;

    if (isHlsLike(videoData)) {
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr) => {
            if (videoData.headers) {
              for (const [k, v] of Object.entries(videoData.headers)) {
                try {
                  xhr.setRequestHeader(k, v);
                } catch {
                  /* some headers are browser-restricted, ignore */
                }
              }
            }
          }
        });
        hlsRef.current = hls;
        hls.loadSource(videoData.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari plays HLS natively.
        video.src = videoData.url;
        video.play().catch(() => {});
      } else {
        setResolveState("error");
        setResolveError("This browser can't play HLS streams.");
      }
    } else {
      video.src = videoData.url;
      video.play().catch(() => {});
    }
  }

  useEffect(() => {
    if (autoStart && resolveState === "ready" && !isPlaying) startPlayback();
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, resolveState]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // ---- download ----
  async function handleDownload() {
    if (!videoData) return;
    setDownloadState("downloading");
    setDownloadProgress(0);
    setDownloadError("");

    const finalName = (filename || videoData.title || "nexfetch-video").trim();

    try {
      if (isHlsLike(videoData)) {
        const { blob, container } = await downloadHls(videoData.url, {
          headers: videoData.headers,
          targetHeight: videoData.height,
          onProgress: setDownloadProgress
        });
        const ext = container === "mp4" ? "mp4" : "ts";
        const blobUrl = URL.createObjectURL(blob);
        const fullName = `${finalName}.${ext}`;

        const bridge = tabId ? new ExtensionBridge(tabId) : null;
        if (bridge?.available) {
          const result = await bridge.sendHlsBlob(blobUrl, fullName);
          bridge.close();
          if (!result.success) throw new Error(result.reason ?? "EXTENSION_SAVE_FAILED");
        } else {
          // No extension on this browser — a plain blob download still
          // works natively, no extension required for this part.
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = fullName;
          a.click();
        }
        setDownloadState("done");
      } else {
        const ext = videoData.extension || "mp4";
        const fullName = `${finalName}.${ext}`;
        const bridge = tabId ? new ExtensionBridge(tabId) : null;

        if (bridge?.available) {
          await bridge.startDownload(videoData.url, fullName);
          bridge.close();
        } else {
          const a = document.createElement("a");
          a.href = videoData.url;
          a.download = fullName;
          a.click();
        }
        setDownloadState("done");
      }
    } catch (err) {
      setDownloadState("error");
      setDownloadError(
        err instanceof Error && err.message === "ENCRYPTED_STREAM_UNSUPPORTED"
          ? "This stream is encrypted (DRM) — NexFetch can't download it."
          : "Download failed — the source may block cross-origin access from this page."
      );
    }
  }

  const chips = useMemo(() => {
    if (!videoData) return [];
    return [
      formatDuration(videoData.duration),
      videoData.quality ?? (videoData.height ? `${videoData.height}p` : null),
      formatBytes(videoData.size),
      (videoData.extension ?? (isHlsLike(videoData) ? "HLS" : null))?.toUpperCase(),
      videoData.webpage_url ? new URL(videoData.webpage_url).hostname : null
    ].filter(Boolean) as string[];
  }, [videoData]);

  if (limitState === "checking" || resolveState === "resolving") {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-center text-white/60">
        {limitState === "checking" ? "Checking your daily stream limit…" : "Loading video…"}
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
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">{resolveError}</div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl text-white">{videoData.title ?? "NexFetch stream"}</h1>

      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/60">
            {c}
          </span>
        ))}
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl glow-border bg-black">
        {!isPlaying ? (
          <button
            onClick={startPlayback}
            className="group relative flex aspect-video w-full items-center justify-center"
          >
            {videoData.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={videoData.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
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

      {videoData.webpage_url && (
        <a
          href={videoData.webpage_url}
          target="_blank"
          className="mt-3 inline-block text-sm text-blue-glow hover:underline"
        >
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
          <span className="text-sm text-white/40">.{isHlsLike(videoData) ? "mp4/ts" : videoData.extension || "mp4"}</span>
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
            <div
              className="h-full bg-nex-gradient transition-all"
              style={{ width: `${Math.round(downloadProgress * 100)}%` }}
            />
          </div>
        )}

        {downloadState === "error" && <p className="mt-3 text-sm text-red-400">{downloadError}</p>}

        {!bridgeAvailable && tabId && (
          <p className="mt-3 text-xs text-white/40">
            NexFetch extension not detected — downloads will use your browser&apos;s normal save dialog instead of a
            silent save.
          </p>
        )}
      </GlassCard>
    </div>
  );
}
