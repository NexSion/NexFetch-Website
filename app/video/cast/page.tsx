"use client";

import { useEffect, useState } from "react";
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
  const title = payload?.title ?? "NexFetch cast";

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
            "Daily cast limit reached (" + json.data.limit + "/day on the free plan). Upgrade for unlimited casting."
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-white">{decodeURIComponent(title)}</h1>
      <p className="mt-2 text-sm text-white/50">
        This tab is the cast source - start casting from the NexFetch toolbar popup.
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