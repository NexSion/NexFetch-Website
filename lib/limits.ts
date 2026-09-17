// Central place for the daily quotas the extension's popup checks
// before starting an HD/HLS download ($e() in popup.js →
// api/streaming/check-limit) or a cast (Mo() → check-cast-limit).
// Both tiers are unlimited — the daily-limit feature is disabled.
export const LIMITS = {
  free: { stream: -1, cast: -1 },
  premium: { stream: -1, cast: -1 }
} as const;

export function limitFor(kind: "stream" | "cast", isPremium: boolean) {
  return isPremium ? LIMITS.premium[kind] : LIMITS.free[kind];
}

export function nextResetAt(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0); // next UTC midnight
  return d.toISOString();
}
