// Central place for the daily quotas enforced in
// app/api/streaming/check-limit and check-cast-limit.
//
// Stream/cast *counts* stay unlimited for both tiers (the product
// never actually gated on a per-action count) — the real free-plan
// constraint is the daily *data* cap: 10GB/day of downloaded video
// for anyone who isn't Premium or an admin. Admins are always treated
// as unlimited, same as Premium, regardless of profiles.is_premium —
// see the `unlimited` computation in check-limit's route handler.
export const LIMITS = {
  free: { stream: -1, cast: -1, bytes: 10 * 1024 * 1024 * 1024 },
  premium: { stream: -1, cast: -1, bytes: -1 }
} as const;

export function limitFor(kind: "stream" | "cast" | "bytes", isUnlimited: boolean) {
  return isUnlimited ? LIMITS.premium[kind] : LIMITS.free[kind];
}

export function nextResetAt(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0); // next UTC midnight
  return d.toISOString();
}
