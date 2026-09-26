export function formatDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 2 : 0)} ${units[i]}`;
}

// "2m 14s left" / "1h 05m left" style ETA, matching the kind of label
// download managers (and vidow's own progress UI) show. Returns null
// when there isn't enough data yet to estimate (caller should show
// "Calculating…" in that case rather than nothing).
export function formatRemaining(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return "almost done";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m left`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s left`;
  return `${s}s left`;
}

// Bytes/sec -> "3.4 MB/s"
export function formatSpeed(bytesPerSecond?: number | null): string | null {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return `${formatBytes(bytesPerSecond)}/s`;
}
