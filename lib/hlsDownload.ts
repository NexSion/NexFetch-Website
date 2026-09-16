"use client";

// A from-scratch, dependency-free HLS downloader: parses master/media
// m3u8 playlists, fetches every segment, and concatenates them into a
// single Blob the extension can hand to chrome.downloads (via
// bridge.sendHlsBlob — see downloads:hls-blob in service_worker.js).
//
// Honest limitations, on purpose rather than by accident:
//  - No AES-128 / SAMPLE-AES decryption. An EXT-X-KEY with METHOD other
//    than NONE throws ENCRYPTED_STREAM_UNSUPPORTED — decrypting would
//    need the key delivery + IV handling wired up, which is real scope
//    beyond what this pass covers.
//  - This concatenates segments; it does not remux to a strictly
//    spec-clean container the way ffmpeg would. For fMP4/CMAF HLS
//    (an EXT-X-MAP init segment present) the result is a genuinely
//    valid fragmented MP4. For legacy .ts-segmented HLS, the result is
//    a valid MPEG-TS file — it plays in VLC/mpv and most players, but
//    isn't repackaged into an .mp4 container.
//  - Only the first variant in a master playlist is auto-picked unless
//    a target height is given.

export interface HlsDownloadResult {
  blob: Blob;
  container: "mp4" | "ts";
  segmentCount: number;
}

export type ProgressCallback = (fraction: number) => void;

function resolveUrl(base: string, ref: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

interface MediaPlaylist {
  segmentUris: string[];
  mapUri: string | null;
  encrypted: boolean;
}

function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split("\n").map((l) => l.trim());
  const segmentUris: string[] = [];
  let mapUri: string | null = null;
  let encrypted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith("#EXT-X-KEY")) {
      const method = /METHOD=([^,]+)/.exec(line)?.[1];
      if (method && method !== "NONE") encrypted = true;
      continue;
    }

    if (line.startsWith("#EXT-X-MAP")) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) mapUri = resolveUrl(baseUrl, uri);
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const next = lines[i + 1];
      if (next && !next.startsWith("#")) {
        segmentUris.push(resolveUrl(baseUrl, next));
        i++;
      }
      continue;
    }
  }

  return { segmentUris, mapUri, encrypted };
}

interface MasterVariant {
  uri: string;
  bandwidth: number;
  height?: number;
}

function parseMasterPlaylist(text: string, baseUrl: string): MasterVariant[] {
  const lines = text.split("\n").map((l) => l.trim());
  const variants: MasterVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const resolution = /RESOLUTION=\d+x(\d+)/.exec(line)?.[1];
    const next = lines[i + 1];
    if (next && !next.startsWith("#")) {
      variants.push({
        uri: resolveUrl(baseUrl, next),
        bandwidth,
        height: resolution ? Number(resolution) : undefined
      });
    }
  }

  return variants;
}

function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`PLAYLIST_FETCH_FAILED_${res.status}`);
  return res.text();
}

async function fetchBuffer(url: string, headers?: Record<string, string>): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
  return res.arrayBuffer();
}

const CONCURRENCY = 4;

async function fetchAllSegments(
  urls: string[],
  headers: Record<string, string> | undefined,
  onProgress?: ProgressCallback
): Promise<ArrayBuffer[]> {
  const results = new Array<ArrayBuffer>(urls.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await fetchBuffer(urls[index], headers);
      completed++;
      onProgress?.(completed / urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

export async function downloadHls(
  playlistUrl: string,
  options: { headers?: Record<string, string>; targetHeight?: number; onProgress?: ProgressCallback } = {}
): Promise<HlsDownloadResult> {
  const { headers, targetHeight, onProgress } = options;

  let mediaPlaylistUrl = playlistUrl;
  const rootText = await fetchText(playlistUrl, headers);

  if (isMasterPlaylist(rootText)) {
    const variants = parseMasterPlaylist(rootText, playlistUrl);
    if (!variants.length) throw new Error("NO_VARIANTS_FOUND");
    const chosen = targetHeight
      ? variants.reduce((best, v) =>
          Math.abs((v.height ?? 0) - targetHeight) < Math.abs((best.height ?? 0) - targetHeight) ? v : best
        )
      : variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best));
    mediaPlaylistUrl = chosen.uri;
  }

  const mediaText = await fetchText(mediaPlaylistUrl, headers);
  const { segmentUris, mapUri, encrypted } = parseMediaPlaylist(mediaText, mediaPlaylistUrl);

  if (encrypted) throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
  if (!segmentUris.length) throw new Error("NO_SEGMENTS_FOUND");

  const allUris = mapUri ? [mapUri, ...segmentUris] : segmentUris;
  const buffers = await fetchAllSegments(allUris, headers, onProgress);

  const container = mapUri ? "mp4" : "ts";
  const blob = new Blob(buffers, { type: container === "mp4" ? "video/mp4" : "video/mp2t" });

  return { blob, container, segmentCount: segmentUris.length };
}
