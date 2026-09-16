// Central place for the two daily quotas the extension checks before
// starting a stream (/api/streaming/check-limit) or a cast
// (/api/streaming/check-cast-limit). Free-tier numbers are placeholders —
// tune them to whatever NexFetch's actual pricing model is; premium is
// unlimited (-1) per the "upgraded" flag already used by the extension.
export const LIMITS = {
  free: { stream: 10, cast: 5 },
  premium: { stream: -1, cast: -1 }
} as const;

export function limitFor(kind: "stream" | "cast", isPremium: boolean) {
  return isPremium ? LIMITS.premium[kind] : LIMITS.free[kind];
}
