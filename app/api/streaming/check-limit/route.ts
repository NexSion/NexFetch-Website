import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor, nextResetAt } from "@/lib/limits";

// POST api/streaming/check-limit  { device_key: string }
//
// Contract confirmed directly from popup.js's $e() function:
//   const t = await Q.post("api/streaming/check-limit", {device_key});
//   if (!t.success || !t.data) throw new Error(...)
//   return t.data   // { remaining, limit, reset_at, reason, allowed,
//                    //   download_access_mode?, trial_enabled?, enforcement_point? }
//
// Two things the first pass of this route got wrong, found by reading
// the actual popup bundle instead of guessing:
//  1. The payload must be nested under `data` — a flat
//     {success, allowed, remaining, limit} response makes popup.js's
//     `!t.data` check true, which is exactly the
//     "HD limit check failed" error in the screenshot.
//  2. This must NEVER require a login cookie. The popup calls it with
//     only a device_key (Chrome extension pages do send credentials
//     cross-origin, but a device that was never claimed to an account
//     is a completely normal, valid caller — it's just free-tier).
const bodySchema = z.object({ device_key: z.string().uuid() });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }
  const { device_key } = parsed.data;
  const service = createSupabaseServiceClient();

  // Resolve premium status: prefer an actual logged-in cookie session
  // (covers the website's own /video/stream page), otherwise fall back
  // to whichever account this device_key is claimed to, otherwise free.
  let isPremium = false;
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await service.from("profiles").select("is_premium").eq("id", user.id).single();
    isPremium = profile?.is_premium ?? false;
  } else {
    const { data: device } = await service
      .from("devices")
      .select("user_id")
      .eq("device_key", device_key)
      .maybeSingle();
    if (device?.user_id) {
      const { data: profile } = await service
        .from("profiles")
        .select("is_premium")
        .eq("id", device.user_id)
        .single();
      isPremium = profile?.is_premium ?? false;
    }
  }

  const limit = limitFor("stream", isPremium);

  if (limit === -1) {
    return NextResponse.json({
      success: true,
      data: { allowed: true, remaining: -1, limit: -1, reset_at: null, reason: null }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await service
    .from("streaming_usage")
    .select("id, count")
    .match(user ? { user_id: user.id, kind: "stream", usage_date: today } : { device_key, kind: "stream", usage_date: today })
    .maybeSingle();

  const currentCount = existing?.count ?? 0;
  const allowed = currentCount < limit;

  if (allowed) {
    if (existing) {
      await service.from("streaming_usage").update({ count: currentCount + 1 }).eq("id", existing.id);
    } else {
      await service.from("streaming_usage").insert({
        ...(user ? { user_id: user.id } : { device_key }),
        kind: "stream",
        usage_date: today,
        count: 1
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      allowed,
      remaining: Math.max(limit - currentCount - (allowed ? 1 : 0), 0),
      limit,
      reset_at: nextResetAt(),
      reason: allowed ? null : "daily_limit_reached"
    }
  });
}
