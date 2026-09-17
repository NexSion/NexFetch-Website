"use client";

// A from-scratch, dependency-free HLS downloader: parses master/media
// m3u8 playlists, fetches every segment, and concatenates them into a
// single Blob the extension can hand to chrome.downloads (via
// bridge.sendHlsBlob — see downloads:hls-blob in service_worker.js).
//
// AES-128 (the standard, non-DRM HLS content-key scheme used by most
// CDNs, including Bunny Stream) is decrypted client-side via
// SubtleCrypto — the key is fetched over HTTP and used with AES-CBC,
// exactly like hls.js does for in-browser playback.
//
// Honest limitations, on purpose rather than by accident:
//  - SAMPLE-AES / SAMPLE-AES-CTR / SAMPLE-AES-CENC (real DRM schemes —
//    Widevine, FairPlay, PlayReady) throw ENCRYPTED_STREAM_UNSUPPORTED.
//    These encrypt individual media samples inside the container and
//    require a licensed key exchange; there's no client-side bypass.
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

interface KeyState {
  method: string;
  keyUri: string;
  ivHex: string | null; // explicit IV attribute, if present (without 0x)
}

interface ParsedSegment {
  uri: string;
  sequence: number;
  key: KeyState | null;
}

interface MediaPlaylist {
  segments: ParsedSegment[];
  mapUri: string | null;
}

const SUPPORTED_ENCRYPTED_METHODS = new Set(["AES-128"]);

function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
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

// Per HLS spec (RFC 8216 §5.2): if EXT-X-KEY has no IV attribute, the
// segment's media-sequence number is used as the IV — a 128-bit
// big-endian integer.
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

async function getAesKey(keyUri: string, headers?: Record<string, string>): Promise<CryptoKey> {
  let cached = keyCache.get(keyUri);
  if (!cached) {
    cached = fetchBuffer(keyUri, headers).then((buf) =>
      crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"])
    );
    keyCache.set(keyUri, cached);
  }
  return cached;
}

async function fetchAndDecryptSegment(
  segment: ParsedSegment,
  headers: Record<string, string> | undefined
): Promise<ArrayBuffer> {
  const buffer = await fetchBuffer(segment.uri, headers);
  if (!segment.key) return buffer;

  if (!SUPPORTED_ENCRYPTED_METHODS.has(segment.key.method) || !segment.key.keyUri) {
    throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
  }

  const aesKey = await getAesKey(segment.key.keyUri, headers);
  const iv = segment.key.ivHex ? hexToBytes(segment.key.ivHex) : sequenceToIv(segment.sequence);
  return crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, aesKey, buffer);
}

const CONCURRENCY = 4;

async function fetchAllSegments(
  segments: ParsedSegment[],
  headers: Record<string, string> | undefined,
  onProgress?: ProgressCallback
): Promise<ArrayBuffer[]> {
  const results = new Array<ArrayBuffer>(segments.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < segments.length) {
      const index = cursor++;
      results[index] = await fetchAndDecryptSegment(segments[index], headers);
      completed++;
      onProgress?.(completed / segments.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segments.length) }, worker));
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
  const { segments, mapUri } = parseMediaPlaylist(mediaText, mediaPlaylistUrl);

  if (!segments.length) throw new Error("NO_SEGMENTS_FOUND");

  // Fail fast (before spending time on segment fetches) if any segment
  // uses a scheme we genuinely can't decrypt.
  for (const seg of segments) {
    if (seg.key && !SUPPORTED_ENCRYPTED_METHODS.has(seg.key.method)) {
      throw new Error("ENCRYPTED_STREAM_UNSUPPORTED");
    }
  }

  const mapBuffer = mapUri ? await fetchBuffer(mapUri, headers) : null;
  const segmentBuffers = await fetchAllSegments(segments, headers, onProgress);
  const buffers = mapBuffer ? [mapBuffer, ...segmentBuffers] : segmentBuffers;

  const container = mapUri ? "mp4" : "ts";
  const blob = new Blob(buffers, { type: container === "mp4" ? "video/mp4" : "video/mp2t" });

  return { blob, container, segmentCount: segments.length };
}
