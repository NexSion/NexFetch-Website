"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ExtensionBridge } from "@/lib/bridge";

// Route matched by manifest.json's content_scripts entry for bridge.js:
//   *://nexfetch.vercel.app/video/cast/*
// This page hosts the media source that a Chromecast receiver pulls
// from — the cast session itself is initiated from the extension
// popup using the Cast SDK; this page's job is (a) enforce the daily
// cast quota and (b) resolve+serve the underlying media URL.
export default function CastPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const tabId = search.get("tid");
  const directUrl = search.get("url");
  const title = search.get("title") ?? "NexFetch cast";

  const [src, setSrc] = useState<string | null>(directUrl);
  const [status, setStatus] = useState<"checking" | "blocked" | "ready" | "error">("checking");
  const [message, setMessage] = useState("Checking your daily cast limit…");

  useEffect(() => {
    let bridge: ExtensionBridge | null = null;

    async function run() {
      try {
        const res = await fetch("/api/streaming/check-cast-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({})
        });
        const json = await res.json();
        if (json.success && json.allowed === false) {
          setStatus("blocked");
          setMessage(`Daily cast limit reached (${json.limit}/day on the free plan). Upgrade for unlimited casting.`);
          return;
        }
      } catch {
        // fail open, same reasoning as the stream page
      }

      if (!directUrl && tabId) {
        bridge = new ExtensionBridge(tabId);
        try {
          const data = (await bridge.getHlsVideoData(params.id)) as { url?: string } | null;
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
      }

      setStatus("ready");
    }

    run();
    return () => bridge?.close();
  }, [directUrl, params.id, tabId]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-white">{decodeURIComponent(title)}</h1>
      <p className="mt-2 text-sm text-white/50">
        This tab is the cast source — start casting from the NexFetch toolbar popup.
      </p>

      <div className="mt-8 rounded-2xl glow-border bg-black/40 p-10">
        {status === "ready" && src ? (
          <video src={src} controls className="mx-auto aspect-video w-full rounded-lg" />
        ) : (
          <p className="text-white/60">{message}</p>
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
