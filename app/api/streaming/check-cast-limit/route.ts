import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor, nextResetAt } from "@/lib/limits";

// POST api/streaming/check-cast-limit  { device_key: string }
// Same corrected shape/logic as check-limit — see Mo() in popup.js,
// which does the identical !t.success||!t.data check and reads
// t.data.allowed, t.data.trial_enabled, t.data.reason.
const bodySchema = z.object({ device_key: z.string().uuid() });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }
  const { device_key } = parsed.data;
  const service = createSupabaseServiceClient();

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

  const limit = limitFor("cast", isPremium);

  if (limit === -1) {
    return NextResponse.json({
      success: true,
      data: { allowed: true, remaining: -1, limit: -1, reset_at: null, reason: null, trial_enabled: false }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await service
    .from("streaming_usage")
    .select("id, count")
    .match(user ? { user_id: user.id, kind: "cast", usage_date: today } : { device_key, kind: "cast", usage_date: today })
    .maybeSingle();

  const currentCount = existing?.count ?? 0;
  const allowed = currentCount < limit;

  if (allowed) {
    if (existing) {
      await service.from("streaming_usage").update({ count: currentCount + 1 }).eq("id", existing.id);
    } else {
      await service.from("streaming_usage").insert({
        ...(user ? { user_id: user.id } : { device_key }),
        kind: "cast",
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
      reason: allowed ? null : "cast_limit_reached",
      trial_enabled: false
    }
  });
}
