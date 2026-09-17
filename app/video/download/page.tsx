"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { decodeDataParam } from "@/lib/dataParam";
import GlassCard from "@/components/GlassCard";

// Route: /video/download?data=<base64>&tid=<tabId>
// Confirmed from popup.js's xo(): the "last resort" path, used when
// the extension couldn't detect a direct video URL on the page at all
// and falls back to asking the website to resolve one server-side.
//
// Honest scope note: this calls the already-built
// /api/video/fetch-video-info scraper (title/og:video meta tags only).
// A real "download anything" resolver — the yt-dlp-style extraction
// vidow.io implies with its "Server Fetch" video group — is a much
// larger, site-by-site scoped project on its own; this page fails
// clearly rather than pretending to support every site.
interface DownloadPayload {
  videoUrl: string;
  title?: string | null;
  thumb?: string | null;
}

export default function ServerFetchDownloadPage() {
  const search = useSearchParams();
  const payload = useMemo(() => decodeDataParam<DownloadPayload>(search.get("data")), [search]);

  const [state, setState] = useState<"resolving" | "found" | "not-found" | "error">("resolving");
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!payload?.videoUrl) {
      setState("error");
      return;
    }
    fetch(`/api/video/fetch-video-info?url=${encodeURIComponent(payload.videoUrl)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.found && json.data?.videoUrl) {
          setResolvedUrl(json.data.videoUrl);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("error"));
  }, [payload]);

  if (!payload) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-white/60">No video data in the link.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-white">{payload.title ?? "Resolving video…"}</h1>

      <GlassCard className="mt-8 glow-border">
        {state === "resolving" && <p className="text-white/60">Looking for a downloadable file on this page…</p>}

        {state === "found" && resolvedUrl && (
          <>
            <p className="text-white">Found a direct video link.</p>
            <a
              href={resolvedUrl}
              download
              className="mt-6 inline-block rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white"
            >
              Download
            </a>
          </>
        )}

        {state === "not-found" && (
          <p className="text-white/60">
            NexFetch couldn&apos;t automatically find a downloadable video on this page.{" "}
            <a href={payload.videoUrl} target="_blank" className="text-blue-glow hover:underline">
              Open the source page
            </a>{" "}
            instead.
          </p>
        )}

        {state === "error" && <p className="text-white/60">Something went wrong resolving this video.</p>}
      </GlassCard>
    </div>
  );
}
