"use client";

import { resolvePlayableUrl, refererFor, fetchBatchEndpoint } from "@/lib/streamProxy";
import {
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  type ParsedSegment
} from "@/lib/hlsDownload";

// Orchestrates a full HLS download as many small Worker calls, instead
// of either (a) one huge Worker call — free-plan Cloudflare Workers cap
// a single invocation at 50 subrequests, so a 2h+ video's 500-1000+
// segments blow straight past that — or (b) the website's own
// /download-range route, which re-fetches *and re-parses* the entire
// playlist on every chunk call; that parsing (plus AES-128 decrypt) is
// real CPU time, and free-plan Workers get just 10ms of CPU per
// invocation, so it failed at an inconsistent point depending on
// playlist size and how much decrypt work landed in that call.
//
// This version fetches and parses the playlist *once*, here in the
// browser (which has no such CPU-time limit), then hands the Worker's
// lean /fetch-batch endpoint an already-resolved list of segment (and
// key) URLs per batch — no parsing there at all, just fetch + decrypt.
//
// Where the bytes land depends on what the browser supports:
//  - File System Access API (Chrome/Edge): writes each batch straight
//    to disk via a FileSystemWritableFileStream as it arrives — no
//    whole-file size ceiling in memory, works for multi-GB videos.
//  - Everywhere else: buffers every batch in memory and assembles one
//    Blob at the end, then triggers a normal <a download> — fine for
//    more modest file sizes, but very large videos may hit browser
//    memory limits.
//
// Each batch fetch retries a few times before giving up — a single
// transient failure (network blip, a momentarily-flaky segment on the
// source CDN) shouldn't have to fail the whole download.

const BATCH_SEGMENTS = 40;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BatchItem {
  uri: string;
  sequence: number;
  key: ParsedSegment["key"];
}

async function fetchTextWithRetry(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastErr = new Error(`PLAYLIST_FETCH_FAILED_${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error("PLAYLIST_FETCH_FAILED");
}

async function fetchBatchWithRetry(
  endpoint: string,
  items: BatchItem[],
  ref: string | null
): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, ref })
      });
      if (res.ok) return await res.arrayBuffer();
      lastErr = new Error(`BATCH_FETCH_FAILED_${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error("BATCH_FETCH_FAILED");
}

type FsWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable: () => Promise<
      WritableStream<Uint8Array> & {
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
      }
    >;
  }>;
};

export interface ChunkedDownloadPayload {
  url: string;
  source_url?: string | null;
}

export class DownloadCancelledError extends Error {
  constructor() {
    super("DOWNLOAD_CANCELLED");
    this.name = "DownloadCancelledError";
  }
}

async function resolveAllItems(
  payload: ChunkedDownloadPayload,
  targetHeight: number | undefined
): Promise<{ items: BatchItem[]; container: "mp4" | "ts" }> {
  const playlistUrl = await resolvePlayableUrl(payload);
  let text = await fetchTextWithRetry(playlistUrl);
  let mediaPlaylistUrl = playlistUrl;

  if (isMasterPlaylist(text)) {
    const variants = parseMasterPlaylist(text, playlistUrl);
    if (!variants.length) throw new Error("NO_VARIANTS_FOUND");
    const chosen = targetHeight
      ? variants.reduce((best, v) =>
          Math.abs((v.height ?? 0) - targetHeight) < Math.abs((best.height ?? 0) - targetHeight) ? v : best
        )
      : variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best));
    mediaPlaylistUrl = await resolvePlayableUrl(payload, chosen.uri);
    text = await fetchTextWithRetry(mediaPlaylistUrl);
  }

  const { segments, mapUri } = parseMediaPlaylist(text, mediaPlaylistUrl);
  if (!segments.length) throw new Error("NO_SEGMENTS_FOUND");
  for (const seg of segments) {
    if (seg.key && seg.key.method !== "AES-128") throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
  }

  const container: "mp4" | "ts" = mapUri ? "mp4" : "ts";
  const items: BatchItem[] = mapUri
    ? [{ uri: mapUri, sequence: -1, key: null }, ...segments.map((s) => ({ uri: s.uri, sequence: s.sequence, key: s.key }))]
    : segments.map((s) => ({ uri: s.uri, sequence: s.sequence, key: s.key }));

  return { items, container };
}

export async function downloadHlsChunked(
  payload: ChunkedDownloadPayload,
  finalName: string,
  targetHeight: number | undefined,
  onProgress: (fraction: number) => void
): Promise<void> {
  const endpoint = fetchBatchEndpoint();
  if (!endpoint) throw new Error("PROXY_NOT_CONFIGURED");

  const { items, container } = await resolveAllItems(payload, targetHeight);
  const ref = refererFor(payload);
  const total = items.length;
  const filename = `${finalName}.${container}`;

  const batches: BatchItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SEGMENTS) {
    batches.push(items.slice(i, i + BATCH_SEGMENTS));
  }

  const fsWindow = window as FsWindow;
  const canUseFsAccess = typeof fsWindow.showSaveFilePicker === "function";

  if (canUseFsAccess) {
    let fileHandle;
    try {
      fileHandle = await fsWindow.showSaveFilePicker!({
        suggestedName: filename,
        types: [
          {
            description: container === "mp4" ? "MP4 video" : "MPEG-TS video",
            accept: { [container === "mp4" ? "video/mp4" : "video/mp2t"]: [`.${container}`] }
          }
        ]
      });
    } catch (err) {
      // AbortError = user closed the save dialog without picking a
      // location — that's a cancel, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") throw new DownloadCancelledError();
      throw err;
    }

    const fileWritable = await fileHandle.createWritable();
    let done = 0;
    for (const batch of batches) {
      const buf = await fetchBatchWithRetry(endpoint, batch, ref);
      await fileWritable.write(new Uint8Array(buf));
      done += batch.length;
      onProgress(Math.min(done / total, 1));
    }
    await fileWritable.close();
    return;
  }

  // Fallback: buffer every batch, then hand off as one Blob download.
  const parts: ArrayBuffer[] = [];
  let done = 0;
  for (const batch of batches) {
    parts.push(await fetchBatchWithRetry(endpoint, batch, ref));
    done += batch.length;
    onProgress(Math.min(done / total, 1));
  }

  const blob = new Blob(parts, { type: container === "mp4" ? "video/mp4" : "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
}
