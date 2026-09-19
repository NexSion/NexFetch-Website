"use client";

import { buildDownloadRangeUrl } from "@/lib/streamProxy";

// Orchestrates a full HLS download as many small Worker calls (see
// buildDownloadRangeUrl / the Worker's /download-range route) rather
// than one huge one — free-plan Cloudflare Workers cap a single
// invocation at 50 subrequests, so a 2h+ video's 500-1000+ segments
// can only be fetched a bounded slice at a time.
//
// Where the bytes land depends on what the browser supports:
//  - File System Access API (Chrome/Edge): streams each chunk straight
//    to disk via a FileSystemWritableFileStream — no in-memory size
//    ceiling, works for multi-GB files.
//  - Everywhere else: buffers chunks in memory and assembles one Blob
//    at the end, then triggers a normal <a download> — fine for more
//    modest file sizes, but large videos may hit browser memory limits.

const CHUNK_SEGMENTS = 40;

type FsWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable: () => Promise<WritableStream<Uint8Array> & { close: () => Promise<void> }>;
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

export async function downloadHlsChunked(
  payload: ChunkedDownloadPayload,
  finalName: string,
  targetHeight: number | undefined,
  onProgress: (fraction: number) => void
): Promise<void> {
  const firstUrl = buildDownloadRangeUrl(payload, 0, CHUNK_SEGMENTS, targetHeight);
  if (!firstUrl) throw new Error("PROXY_NOT_CONFIGURED");

  const first = await fetch(firstUrl);
  if (!first.ok || !first.body) {
    throw new Error(`SEGMENT_FETCH_FAILED_${first.status}`);
  }

  const total = Number(first.headers.get("X-Total-Segments") ?? "0");
  const container = first.headers.get("X-Container") === "mp4" ? "mp4" : "ts";
  const firstCount = Number(first.headers.get("X-Range-Count") ?? String(CHUNK_SEGMENTS));
  const filename = `${finalName}.${container}`;

  if (!total) throw new Error("NO_SEGMENTS_FOUND");

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

    await first.body.pipeTo(fileWritable, { preventClose: true });
    let start = firstCount;
    onProgress(start / total);

    while (start < total) {
      const url = buildDownloadRangeUrl(payload, start, CHUNK_SEGMENTS, targetHeight);
      if (!url) throw new Error("PROXY_NOT_CONFIGURED");
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
      await res.body.pipeTo(fileWritable, { preventClose: true });
      const returned = Number(res.headers.get("X-Range-Count") ?? String(CHUNK_SEGMENTS)) || CHUNK_SEGMENTS;
      start += returned;
      onProgress(Math.min(start / total, 1));
    }

    await fileWritable.close();
    return;
  }

  // Fallback: buffer everything, then hand off as one Blob download.
  const parts: ArrayBuffer[] = [await first.arrayBuffer()];
  let start = firstCount;
  onProgress(start / total);

  while (start < total) {
    const url = buildDownloadRangeUrl(payload, start, CHUNK_SEGMENTS, targetHeight);
    if (!url) throw new Error("PROXY_NOT_CONFIGURED");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
    parts.push(await res.arrayBuffer());
    const returned = Number(res.headers.get("X-Range-Count") ?? String(CHUNK_SEGMENTS)) || CHUNK_SEGMENTS;
    start += returned;
    onProgress(Math.min(start / total, 1));
  }

  const blob = new Blob(parts, { type: container === "mp4" ? "video/mp4" : "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
}
