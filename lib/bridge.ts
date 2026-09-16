"use client";

// Client-side counterpart to NexFetch-Chrome's content_scripts/bridge.js.
// The extension injects bridge.js only on nexfetch.vercel.app/video/stream/*
// and /video/cast/* (see manifest.json content_scripts), where it opens a
// BroadcastChannel named `channel-${tabId}` and answers a small set of
// commands. This page-side helper mirrors that protocol so /video/stream
// and /video/cast can actually talk to the extension instead of just
// rendering a static player.
//
// Allowed commands (see bridge.js's `O` allow-list for EXT_SEND, and its
// `p` map for direct commands):
//   GET_TAB_ID
//   GET_HLS_VIDEO_DATA          { uuid }
//   EXT_SEND -> downloads:start       { url, fileName, tabId? }
//   EXT_SEND -> downloads:settings
//   EXT_SEND -> downloads:hls-blob    { blobUrl, fileName }
//   EXT_SEND -> savedVideos:get       { hash }
//   EXT_SEND -> savedVideos:add       { video }
//   EXT_SEND -> savedVideos:remove    { hash }

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
      // BroadcastChannel unsupported or extension not installed —
      // callers should treat `available` as false and fall back to
      // direct <video> playback of the raw URL.
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
    return this.send("GET_TAB_ID");
  }

  getHlsVideoData(uuid: string) {
    return this.send("GET_HLS_VIDEO_DATA", { uuid });
  }

  startDownload(url: string, fileName: string) {
    return this.send("EXT_SEND", { message: "downloads:start", url, fileName });
  }

  getDownloadSettings() {
    return this.send("EXT_SEND", { message: "downloads:settings" });
  }

  close() {
    this.channel?.close();
    this.channel = null;
  }
}
