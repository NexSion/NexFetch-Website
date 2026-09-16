"use client";

// Client-side counterpart to NexFetch-Chrome's content_scripts/bridge.js.
// The extension injects bridge.js only on nexfetch.vercel.app/video/stream/*
// and /video/cast/* (manifest.json content_scripts), where it opens a
// BroadcastChannel named `channel-${tabId}` and answers a small set of
// commands. This mirrors that protocol page-side.

export interface VideoLinkData {
  url: string;
  webpage_url?: string;
  fileName?: string;
  title?: string;
  extension?: string; // "mp4" | "m3u8" | "mpd" | "webm" | ...
  quality?: string; // e.g. "1080p"
  width?: number;
  height?: number;
  isLive?: boolean;
  headers?: Record<string, string>; // Referer/Origin/etc some sources need
  uuid?: string;
  duration?: number; // seconds
  size?: number; // bytes, when known
  audioBitrate?: number;
  associatedAudioUrl?: string; // separate audio track for muxed-apart HLS
  thumbnail?: string;
  groupLabel?: string;
  sizeStatus?: string;
}

type BridgeReply = { id: number; data: unknown };

export class ExtensionBridge {
  private channel: BroadcastChannel | null = null;
  private nextId = 1;
  private pending = new Map<number, (data: unknown) => void>();

  constructor(private tabId: string) {
    if (typeof window === "undefined") return;
    try {
      this.channel = new BroadcastChannel(`channel-${tabId}`);
      this.channel.addEventListener("message", (event: MessageEvent<BridgeReply>) => {
        const { id, data } = event.data ?? {};
        const resolve = this.pending.get(id);
        if (resolve) {
          resolve(data);
          this.pending.delete(id);
        }
      });
    } catch {
      // BroadcastChannel unsupported, or the extension never injected
      // bridge.js on this page (not installed / not on nexfetch.vercel.app)
      this.channel = null;
    }
  }

  get available() {
    return this.channel !== null;
  }

  private send(cmd: string, data?: unknown, timeoutMs = 8000): Promise<unknown> {
    if (!this.channel) return Promise.reject(new Error("BRIDGE_UNAVAILABLE"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("BRIDGE_TIMEOUT"));
      }, timeoutMs);

      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.channel!.postMessage({ id, cmd, data });
    });
  }

  getTabId() {
    return this.send("GET_TAB_ID") as Promise<number>;
  }

  // Returns the full videoLink object background/service_worker.js's Oi()
  // stores for this tab (url, thumbnail, duration, quality, size,
  // headers, etc.) — see VideoLinkData above — or null if not found.
  getHlsVideoData(uuid: string) {
    return this.send("GET_HLS_VIDEO_DATA", { uuid }) as Promise<VideoLinkData | null>;
  }

  // Progressive file (mp4/webm/direct URL): the extension's own
  // chrome.downloads call handles it directly, no conversion needed.
  startDownload(url: string, fileName: string) {
    return this.send("EXT_SEND", { message: "downloads:start", url, fileName }) as Promise<{
      ok: boolean;
    }>;
  }

  // HLS/DASH: chrome.downloads can't turn a .m3u8 playlist into a
  // playable file on its own, so the PAGE assembles a blob first (see
  // lib/hlsDownload.ts) and hands that blob's object URL to the
  // extension, which saves it via chrome.downloads.
  sendHlsBlob(blobUrl: string, fileName: string) {
    return this.send("EXT_SEND", { message: "downloads:hls-blob", blobUrl, fileName }) as Promise<{
      success: boolean;
      reason?: string;
    }>;
  }

  getDownloadSettings() {
    return this.send("EXT_SEND", { message: "downloads:settings" });
  }

  close() {
    this.channel?.close();
    this.channel = null;
  }
}
