"use client";

// A from-scratch, dependency-free HLS downloader: parses master/media
// m3u8 playlists, fetches every segment, and concatenates them into a
// single Blob. AES-128 is decrypted client-side via SubtleCrypto.
//
// Proxy-aware fetching: some sources (Bunny Stream pull zones with
// Referer allow-lists, etc.) reject a direct browser fetch outright.
// When that happens for a given host, every subsequent fetch to that
// host is routed through the Worker's lean relay endpoint instead
// (see cloudflare-worker/stream-proxy.js's handlePlaybackProxy) — the
// Worker never decrypts, only relays bytes, so it stays CPU-cheap
// regardless of segment size. Decryption always happens here in the
// browser, which has no CPU-time limit.
//
// Pause/resume/cancel: callers pass a DownloadController and can call
// .pause()/.resume()/.cancel() on it from the UI while a download is
// in flight — segment workers check it between fetches. Progress is
// reported as {fraction, completed, total, bytesLoaded} so the UI can
// show "12/340 segments · 84 MB" style detail, matching what a normal
// download manager shows.
//
// Honest limitations, on purpose rather than by accident:
//  - SAMPLE-AES / SAMPLE-AES-CTR / SAMPLE-AES-CENC (real DRM schemes)
//    throw ENCRYPTED_STREAM_UNSUPPORTED — no client-side bypass exists.
//  - This concatenates segments; for fMP4/CMAF HLS (EXT-X-MAP present)
//    the result is a valid fragmented MP4. For legacy .ts-segmented
//    HLS, the result is a valid MPEG-TS file — plays in VLC/mpv, not
//    repackaged into .mp4.
//  - Only the first/best variant in a master playlist is auto-picked
//    unless a target height is given.
//  - The whole file is assembled in browser memory before being handed
//    back as a Blob — fine up to a few GB on a modern desktop browser.

import { needsProxy, buildProxiedUrl } from "@/lib/streamProxy";

export interface HlsDownloadResult {
  blob: Blob;
  container: "mp4" | "ts";
  segmentCount: number;
}

export interface DownloadProgressInfo {
  fraction: number;
  completed: number;
  total: number;
  bytesLoaded: number;
}

export type ProgressCallback = (info: DownloadProgressInfo) => void;

// Passed by the caller so the UI can pause/resume/cancel an in-flight
// download. Segment workers poll `.paused` between fetches and throw
// DOWNLOAD_CANCELLED if `.cancelled` is set.
export class DownloadController {
  paused = false;
  cancelled = false;
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  cancel() {
    this.cancelled = true;
  }
}

async function waitWhilePaused(controller?: DownloadController) {
  while (controller?.paused && !controller.cancelled) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (controller?.cancelled) throw new Error("DOWNLOAD_CANCELLED");
}

export function resolveUrl(base: string, ref: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

export interface KeyState {
  method: string;
  keyUri: string;
  ivHex: string | null;
}

export interface ParsedSegment {
  uri: string;
  sequence: number;
  key: KeyState | null;
}

export interface MediaPlaylist {
  segments: ParsedSegment[];
  mapUri: string | null;
}

const SUPPORTED_ENCRYPTED_METHODS = new Set(["AES-128"]);

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split("\n").map((l) => l.trim());
  const segments: ParsedSegment[] = [];
  let mapUri: string | null = null;
  let currentKey: KeyState | null = null;
  let sequence = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
      const n = Number(line.split(":")[1]);
      if (!Number.isNaN(n)) sequence = n;
      continue;
    }

    if (line.startsWith("#EXT-X-KEY")) {
      const method = /METHOD=([^,]+)/.exec(line)?.[1] ?? "NONE";
      if (method === "NONE") {
        currentKey = null;
      } else {
        const uri = /URI="([^"]+)"/.exec(line)?.[1];
        const iv = /IV=0[xX]([0-9a-fA-F]+)/.exec(line)?.[1] ?? null;
        currentKey = {
          method,
          keyUri: uri ? resolveUrl(baseUrl, uri) : "",
          ivHex: iv
        };
      }
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
        segments.push({ uri: resolveUrl(baseUrl, next), sequence, key: currentKey });
        sequence++;
        i++;
      }
      continue;
    }
  }

  return { segments, mapUri };
}

export interface MasterVariant {
  uri: string;
  bandwidth: number;
  height?: number;
}

export function parseMasterPlaylist(text: string, baseUrl: string): MasterVariant[] {
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

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

const proxyDecisionCache = new Map<string, boolean>();

async function resolveFetchUrl(url: string, refererUrl: string | null | undefined): Promise<string> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return url;
  }
  let goThroughProxy = proxyDecisionCache.get(host);
  if (goThroughProxy === undefined) {
    goThroughProxy = await needsProxy(url);
    proxyDecisionCache.set(host, goThroughProxy);
  }
  return goThroughProxy ? buildProxiedUrl(url, refererUrl ?? null) : url;
}

async function fetchText(url: string, headers?: Record<string, string>, refererUrl?: string | null): Promise<string> {
  const finalUrl = await resolveFetchUrl(url, refererUrl);
  const res = await fetch(finalUrl, { headers });
  if (!res.ok) throw new Error(`PLAYLIST_FETCH_FAILED_${res.status}`);
  return res.text();
}

async function fetchBuffer(url: string, headers?: Record<string, string>, refererUrl?: string | null): Promise<ArrayBuffer> {
  const finalUrl = await resolveFetchUrl(url, refererUrl);
  const res = await fetch(finalUrl, { headers });
  if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
  return res.arrayBuffer();
}

function sequenceToIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  let n = sequence;
  for (let i = 15; i >= 0 && n > 0; i--) {
    iv[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return iv;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

async function getAesKey(
  keyUri: string,
  headers: Record<string, string> | undefined,
  refererUrl: string | null | undefined
): Promise<CryptoKey> {
  let cached = keyCache.get(keyUri);
  if (!cached) {
    cached = fetchBuffer(keyUri, headers, refererUrl).then((buf) =>
      crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"])
    );
    keyCache.set(keyUri, cached);
  }
  return cached;
}

async function fetchAndDecryptSegment(
  segment: ParsedSegment,
  headers: Record<string, string> | undefined,
  refererUrl: string | null | undefined
): Promise<ArrayBuffer> {
  const buffer = await fetchBuffer(segment.uri, headers, refererUrl);
  if (!segment.key) return buffer;

  if (!SUPPORTED_ENCRYPTED_METHODS.has(segment.key.method) || !segment.key.keyUri) {
    throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
  }

  const aesKey = await getAesKey(segment.key.keyUri, headers, refererUrl);
  const iv = segment.key.ivHex ? hexToBytes(segment.key.ivHex) : sequenceToIv(segment.sequence);
  return crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, aesKey, buffer);
}

const CONCURRENCY = 4;

async function fetchAllSegments(
  segments: ParsedSegment[],
  headers: Record<string, string> | undefined,
  refererUrl: string | null | undefined,
  controller: DownloadController | undefined,
  onProgress?: ProgressCallback
): Promise<ArrayBuffer[]> {
  const results = new Array<ArrayBuffer>(segments.length);
  let completed = 0;
  let bytesLoaded = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < segments.length) {
      await waitWhilePaused(controller);
      if (controller?.cancelled) throw new Error("DOWNLOAD_CANCELLED");

      const index = cursor++;
      const buf = await fetchAndDecryptSegment(segments[index], headers, refererUrl);
      results[index] = buf;
      completed++;
      bytesLoaded += buf.byteLength;
      onProgress?.({ fraction: completed / segments.length, completed, total: segments.length, bytesLoaded });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segments.length) }, worker));
  return results;
}

export async function downloadHls(
  playlistUrl: string,
  options: {
    headers?: Record<string, string>;
    targetHeight?: number;
    onProgress?: ProgressCallback;
    refererUrl?: string | null;
    controller?: DownloadController;
  } = {}
): Promise<HlsDownloadResult> {
  const { headers, targetHeight, onProgress, refererUrl, controller } = options;

  let mediaPlaylistUrl = playlistUrl;
  const rootText = await fetchText(playlistUrl, headers, refererUrl);

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

  const mediaText = await fetchText(mediaPlaylistUrl, headers, refererUrl);
  const { segments, mapUri } = parseMediaPlaylist(mediaText, mediaPlaylistUrl);

  if (!segments.length) throw new Error("NO_SEGMENTS_FOUND");

  for (const seg of segments) {
    if (seg.key && !SUPPORTED_ENCRYPTED_METHODS.has(seg.key.method)) {
      throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
    }
  }

  const mapBuffer = mapUri ? await fetchBuffer(mapUri, headers, refererUrl) : null;
  const segmentBuffers = await fetchAllSegments(segments, headers, refererUrl, controller, onProgress);
  const buffers = mapBuffer ? [mapBuffer, ...segmentBuffers] : segmentBuffers;

  const container = mapUri ? "mp4" : "ts";
  const blob = new Blob(buffers, { type: container === "mp4" ? "video/mp4" : "video/mp2t" });

  return { blob, container, segmentCount: segments.length };
}
